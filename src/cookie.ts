/**
 * The consent cookie: read from the request, written by the server.
 *
 * The whole idea rests on one fact: the cookie is first-party, so it travels
 * with the inbound request. The Worker therefore knows the answer before it
 * writes the first byte, and can send HTML in which the non-consented scripts
 * are already inert, rather than sending live tags and asking a client-side
 * patch to beat the parser to them, which is what a generic CMP does.
 */

import type { CategoryId, Consent } from './types.ts';

export const COOKIE = '__consent';

export const CATEGORY_IDS: CategoryId[] = ['essential', 'analytics', 'marketing'];

/** Max age of a *choice*, not of the cookie file. CNIL recommends six months. */
const SIX_MONTHS = 60 * 60 * 24 * 182;

/**
 * Deliberately a readable, compact string rather than base64 JSON: being able
 * to read the cookie in devtools without decoding it is worth more than the
 * handful of bytes a packed format would save.
 *
 *   1~analytics,marketing~k3f9x2~1760000000
 *   ^  ^                  ^      ^
 *   |  |                  |      decision time, unix seconds
 *   |  |                  reference shown to the visitor
 *   |  categories granted, besides essential
 *   policy version
 */
export function readConsent(request: Request, policyVersion = 1): Consent | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;

  /* Every `__consent` the browser sent, and the most recent decision wins.
   * There can be two: a host-only cookie from before a site started sharing its
   * choice across subdomains (Domain=), and the shared one. The browser sends
   * both and says nothing about which is which, so the newer decision is the
   * one the visitor meant. */
  let best: Consent | null = null;
  for (const part of header.split(';').map((p) => p.trim())) {
    if (!part.startsWith(COOKIE + '=')) continue;
    const parsed = parseConsent(part.slice(COOKIE.length + 1), policyVersion);
    if (parsed && (!best || parsed.at > best.at)) best = parsed;
  }
  return best;
}

export function parseConsent(raw: string, policyVersion = 1): Consent | null {
  /* `decodeURIComponent` throws URIError on a malformed escape, and a cookie is
   * attacker-controlled input: `__consent=%%%%` was a 500 on every page until
   * this try/catch existed. Nothing a visitor can put in a cookie may be able
   * to take the site down. A consent tool that breaks the site gets removed
   * the same day, which is a worse outcome than having no consent tool. */
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }

  const [version, granted, id, at] = decoded.split('~');

  /* A policy version that does not match is not a malformed cookie, it is a
   * stale choice: a vendor was added since, so the question has changed and the
   * answer has to be asked again. Returning null re-opens the banner. */
  if (Number(version) !== policyVersion) return null;
  if (!id) return null;

  const cats = (granted || '')
    .split(',')
    .filter(Boolean)
    .filter((c): c is CategoryId => CATEGORY_IDS.includes(c as CategoryId));

  return { version: policyVersion, granted: cats, id, at: Number(at) || 0 };
}

/**
 * `domain`, when a site shares its choice across its subdomains (the website,
 * the docs and the app of one product): `Domain=.example.com`. Left out, the
 * cookie is host-only, which is what a site with one host wants.
 */
export function serializeConsent(consent: Consent, secure: boolean, domain?: string): string {
  const value = [consent.version, consent.granted.join(','), consent.id, consent.at].join('~');
  /* Lax, not Strict: a visitor arriving from a search result must not be asked
   * again because the cookie was withheld on a cross-site navigation.
   *
   * HttpOnly is affordable because the server is what reads this: the client
   * runtime never needs it. No third-party script can read the choice, and none
   * can forge one. A client-side CMP cannot have this. */
  return (
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${SIX_MONTHS}; SameSite=Lax; HttpOnly` +
    (domain ? `; Domain=${domain}` : '') +
    (secure ? '; Secure' : '')
  );
}

/** Expires the host-only cookie (no Domain). A cookie is identified by name,
 *  domain and path, so this removes the old host-only one without touching a
 *  shared one. */
export function expireHostOnlyConsent(secure: boolean): string {
  return `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly` + (secure ? '; Secure' : '');
}

/** Expires the shared cookie. */
export function expireSharedConsent(secure: boolean, domain: string): string {
  return `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Domain=${domain}` + (secure ? '; Secure' : '');
}

export function isGranted(consent: Consent | null, category: string): boolean {
  if (category === 'essential') return true;
  return !!consent && consent.granted.includes(category as CategoryId);
}
