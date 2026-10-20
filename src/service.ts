import { COOKIE, expireHostOnlyConsent, expireSharedConsent, readConsent, serializeConsent } from './cookie.ts';
import { resolveCopy, resolveTheme } from './config.ts';
import { withConsent } from './rewrite.ts';
import { bannerHtml } from './ui.ts';
import { clientAddress } from './client-address.ts';
import type {
  CategoryId,
  Consent,
  ConsentConfig,
  ConsentEnv,
  CreateConsentDeps,
  RewriterConstructor,
} from './types.ts';

/* A decision is a few dozen bytes. The cap is read on the declared length AND on the bytes
 * actually received: the body used to be parsed uncapped (security audit, 2026-10-19). */
const MAX_BODY_BYTES = 4 * 1024;

/* Read as a stream: stop and cancel as soon as the count passes the cap, never buffer then check. */
class BodyTooLarge extends Error {}

async function readBounded(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const declared = Number(request.headers.get('content-length'));
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLarge();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new BodyTooLarge();
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/* One proof row per decision is the cost model; one address changing its mind more than this in a
 * minute is not a visitor. Generous on purpose: an office shares an address. */
const WRITES_PER_MINUTE = 30;

/**
 * Pseudonym: storing an IP in clear to prove a consent is itself a processing
 * that would then need justifying.
 */
async function fingerprint(ua: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ua));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The request to the asset layer, for a page.
 *
 * Without conditional validators. The document we send back depends on the
 * consent cookie, not only on the file: if the browser sends `If-None-Match`
 * and the asset layer answers 304, we would return a 304 and the browser would
 * pull the old document out of its cache, rendered for the OLD choice.
 * Measured: a withdrawal of consent reloads the page, the server answers 304,
 * and the page comes back with every tracker running.
 */
export function pageRequest(request: Request): Request {
  if (!request.headers.has('if-none-match') && !request.headers.has('if-modified-since')) return request;
  const headers = new Headers(request.headers);
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  return new Request(request, { headers });
}

/**
 * Builds the consent engine for one site.
 *
 * The config is an argument, not a module the engine imports: the same code
 * serves any number of sites, and a site's declarations stay in one object you
 * can read in a pull request.
 *
 *   const consent = createConsent({ site: 'my-site', vendors: [...], cookies: {...} });
 */
export function createConsent(config: ConsentConfig, deps: CreateConsentDeps = {}) {
  const site = config.site;
  if (!site) throw new Error('createConsent: `site` is required (it is the key in the proof log).');

  const policyVersion = config.policyVersion ?? 1;
  const vendors = config.vendors ?? [];
  const cookies = config.cookies ?? {};
  const theme = resolveTheme(config.theme);
  const rejectStyle = config.rejectStyle ?? 'button';
  const preferencesPath = config.preferencesPath ?? '/cookie-information#cookie-preferences';
  const googleConsentMode = config.googleConsentMode ?? false;
  const copyFor = (locale: string) => resolveCopy(locale, config.copy);
  const getRewriter = (): RewriterConstructor => {
    const ctor = deps.HTMLRewriter ?? (globalThis as { HTMLRewriter?: RewriterConstructor }).HTMLRewriter;
    if (!ctor) throw new Error('createConsent: no HTMLRewriter. Run in a Worker, or pass one in the second argument.');
    return ctor;
  };

  /* The banner of an undecided visitor is identical for everyone in a given
   * language: rendered once per isolate and per locale, not once per request. */
  const firstVisit = new Map<string, string>();
  function undecidedBanner(locale: string): string {
    let html = firstVisit.get(locale);
    if (!html) {
      html = bannerHtml(copyFor(locale), theme, null, rejectStyle);
      firstVisit.set(locale, html);
    }
    return html;
  }

  /**
   * The Domain a site shares its choice under, for THIS request: only when the
   * request really is on that domain. A branch preview (`*.workers.dev`) or
   * `localhost` keeps a host-only cookie, because a browser rejects a Domain it
   * does not belong to and the choice would silently never be saved.
   */
  function sharedDomain(url: URL): string | undefined {
    if (!config.cookieDomain) return undefined;
    const bare = config.cookieDomain.replace(/^\./, '');
    return url.hostname === bare || url.hostname.endsWith('.' + bare) ? config.cookieDomain : undefined;
  }

  const read = (request: Request) => readConsent(request, policyVersion);

  /* The in-isolate counter that stands in when no CONSENT_LIMITER binding is configured, so a fork
   * without the binding is still bounded. Per isolate, so approximate by design. */
  const recent = new Map<string, number[]>();
  function localLimit(key: string, limit = WRITES_PER_MINUTE, windowMs = 60_000): boolean {
    const now = Date.now();
    const hits = (recent.get(key) ?? []).filter((t) => now - t < windowMs);
    hits.push(now);
    recent.set(key, hits);
    if (recent.size > 5000) for (const [k, v] of recent) if (!v.some((t) => now - t < windowMs)) recent.delete(k);
    return hits.length <= limit;
  }

  /** May this address have its decision written to the proof log? Counted by /64 for IPv6. */
  async function mayWriteProof(request: Request, env: ConsentEnv): Promise<boolean> {
    const key = `consent:${clientAddress(request)}`;
    if (env.CONSENT_LIMITER) {
      try {
        return (await env.CONSENT_LIMITER.limit({ key })).success;
      } catch (error) {
        console.error(JSON.stringify({ event: 'consent-limiter-failed', error: String(error) }));
      }
    }
    return localLimit(key);
  }

  /**
   * The two consent routes. Returns `null` when the URL is not one, so the
   * router carries on.
   *
   *   POST /api/consent          records a decision, sets the cookie
   *   GET  /api/consent/banner   the banner markup (footer link, preferences page)
   */
  async function handleConsentApi(request: Request, env: ConsentEnv = {}): Promise<Response | null> {
    const url = new URL(request.url);
    const consent = read(request);

    if (url.pathname === '/api/consent/banner') {
      const locale = (url.searchParams.get('locale') || 'en').slice(0, 2).toLowerCase();
      return new Response(bannerHtml(copyFor(locale), theme, consent, rejectStyle), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (url.pathname !== '/api/consent') return null;
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    let raw: string;
    try {
      raw = await readBounded(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLarge) return Response.json({ error: 'too large' }, { status: 413 });
      throw error;
    }

    let body: { granted?: string[]; locale?: string };
    try {
      const parsed: unknown = JSON.parse(raw);
      /* `null`, a number or a string are valid JSON and not a decision body. */
      body = parsed && typeof parsed === 'object' ? (parsed as typeof body) : {};
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }

    const valid: CategoryId[] = ['essential', 'analytics', 'marketing'];
    const granted = (Array.isArray(body.granted) ? body.granted : []).filter(
      (c, i, all): c is CategoryId => valid.includes(c as CategoryId) && c !== 'essential' && all.indexOf(c) === i,
    );

    const decision: Consent = {
      version: policyVersion,
      granted,
      id: crypto.randomUUID().slice(0, 8),
      at: Math.floor(Date.now() / 1000),
    };

    /* One row per DECISION, never per page view: a visitor who comes back ten
     * times writes nothing. That is what keeps the cost flat.
     *
     * The schema comes from migrations/0001_consent_log.sql and NOT from a
     * `CREATE TABLE IF NOT EXISTS` here: measured, that form does nothing when
     * the table already exists with other columns, so a schema change goes
     * unnoticed until the first INSERT fails.
     *
     * And a failure does not interrupt the decision. A visitor must be able to
     * REFUSE even when the database is down: answering with an error would
     * leave them with the banner and no way to say no, which is worse than the
     * hole in the log. So the hole is shouted in the logs, not inflicted on
     * the visitor.
     *
     * Over the per-address limit the DECISION still counts (the cookie below) and
     * only the proof row is skipped: a counter must never be the reason a visitor
     * cannot refuse (security audit, 2026-10-19). */
    if (!(await mayWriteProof(request, env))) {
      console.error(JSON.stringify({ event: 'consent-proof-rate-limited', id: decision.id }));
    } else if (env.DB) {
      try {
        await env.DB.prepare(
          'INSERT INTO consent_log (id, site, at, policy_version, granted, country, client, locale) VALUES (?,?,?,?,?,?,?,?)',
        )
          .bind(
            decision.id,
            site,
            decision.at,
            policyVersion,
            granted.join(',') || '-',
            (request as { cf?: { country?: string } }).cf?.country ?? 'XX',
            await fingerprint(request.headers.get('user-agent') ?? '', env.PROOF_SALT ?? site),
            (typeof body.locale === 'string' ? body.locale : 'en').slice(0, 2),
          )
          .run();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'consent-proof-write-failed',
            id: decision.id,
            granted: granted.join(',') || '-',
            error: String(error),
          }),
        );
      }
    } else {
      console.error(JSON.stringify({ event: 'consent-proof-no-binding', id: decision.id }));
    }

    const secure = url.protocol === 'https:';
    const headers = new Headers({ 'cache-control': 'no-store' });
    const domain = sharedDomain(url);
    headers.append('set-cookie', serializeConsent(decision, secure, domain));
    /* Moving to a shared cookie leaves a host-only one behind on this host
     * (from before the site shared its choice): expire it, or the two would
     * coexist. */
    if (domain) headers.append('set-cookie', expireHostOnlyConsent(secure));
    return Response.json({ granted: ['essential', ...granted], id: decision.id, at: decision.at }, { headers });
  }

  /** Erases the choice and sends the visitor to the preferences page. Useful for testing, and for a "start over" link. */
  function clearConsent(request?: Request): Response {
    const headers = new Headers({ location: preferencesPath, 'cache-control': 'no-store' });
    headers.append('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`);
    const url = request ? new URL(request.url) : null;
    const domain = url ? sharedDomain(url) : undefined;
    if (domain) headers.append('set-cookie', expireSharedConsent(url!.protocol === 'https:', domain));
    return new Response(null, { status: 303, headers });
  }

  /**
   * The one entry point the router calls on an HTML page, after the asset layer
   * has answered.
   *
   * Streaming: the first byte leaves while the rest of the document is still
   * being parsed, so no TTFB is added.
   *
   * The response is this visitor's own: the file's validators are removed
   * (`ETag` and `Last-Modified` would describe the file, not the rewritten
   * document), it may not be reused without revalidating, and it declares that
   * it varies with the cookie. Without this, a cache serves a visitor the
   * document rendered for somebody else's choice.
   */
  function applyConsent(request: Request, response: Response): Response {
    const consent = read(request);
    const out = withConsent(response, {
      consent,
      policyVersion,
      banner: consent ? null : undecidedBanner,
      vendors,
      cookies,
      copyFor,
      googleConsentMode,
      HTMLRewriter: getRewriter(),
    });
    if (!(out.headers.get('content-type') || '').includes('text/html')) return out;
    const headers = new Headers(out.headers);
    headers.delete('etag');
    headers.delete('last-modified');
    headers.set('cache-control', 'private, no-cache');
    headers.append('vary', 'Cookie');
    return new Response(out.body, { status: out.status, statusText: out.statusText, headers });
  }

  return { handleConsentApi, clearConsent, pageRequest, applyConsent };
}
