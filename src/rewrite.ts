/**
 * The transform: what the Worker does to an HTML response.
 *
 * Streaming, so it adds no TTFB: the first bytes leave while the rest of the
 * document is still being parsed.
 */

import { RUNTIME } from './runtime.ts';
import { isGranted } from './cookie.ts';
import type { CategoryId, Consent, Copy, RewriterConstructor, Vendor } from './types.ts';

export type WithConsentOptions = {
  consent: Consent | null;
  policyVersion: number;
  /**
   * The banner markup, already rendered. Null for a visitor who has already
   * decided: the markup is then fetched on the footer click instead, which is
   * the only time anything can reveal it.
   *
   * A function and not a string: the document's language is only known once
   * the <html> tag has been seen, and the banner has to speak it.
   */
  banner: ((locale: string) => string) | null;
  vendors: Vendor[];
  cookies: Record<string, string[]>;
  copyFor: (locale: string) => Copy;
  googleConsentMode: boolean;
  HTMLRewriter: RewriterConstructor;
};

/** Google Consent Mode v2 keys, mapped from our own categories. */
function consentModeState(consent: Consent | null) {
  const analytics = isGranted(consent, 'analytics') ? 'granted' : 'denied';
  const marketing = isGranted(consent, 'marketing') ? 'granted' : 'denied';
  return {
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
    analytics_storage: analytics,
    functionality_storage: 'granted',
    personalization_storage: analytics,
    security_storage: 'granted',
  };
}

/**
 * JSON for the inside of an inline <script>. `JSON.stringify` leaves `<` alone,
 * so a `</script>` in the banner copy would end the script early and spill the
 * rest into the page. Escaping `<` as a unicode escape keeps the JSON identical once
 * parsed and impossible to break out of.
 */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Injected at the very top of <head>, before anything else can run.
 *
 * With Google Consent Mode on, this is the move a client-side CMP cannot make.
 * It has to emit `denied` and then an `update` once its own script has
 * executed, so every returning visitor who already consented pays
 * `wait_for_update` and risks losing hits. We read the cookie off the request,
 * so for that visitor we emit `granted` outright and the tag is correct on the
 * first frame.
 */
function headScript(consent: Consent | null, googleConsentMode: boolean): string {
  let js = 'window.__consentGranted=' + scriptJson(['essential', ...(consent?.granted ?? [])]) + ';';
  if (googleConsentMode) {
    const state = consentModeState(consent);
    js =
      'window.dataLayer=window.dataLayer||[];' +
      'function gtag(){dataLayer.push(arguments)}' +
      'gtag("consent","default",' +
      scriptJson(consent === null ? { ...state, wait_for_update: 500 } : state) +
      ');' +
      js;
  }
  return '<script>' + js + '</script>';
}

function stateScript(
  consent: Consent | null,
  policyVersion: number,
  blockedAtEdge: string[],
  cookies: Record<string, string[]>,
  locale: string,
  copy: Copy,
): string {
  return (
    'window.__consentState=' +
    scriptJson({
      policyVersion,
      /* What "accept all" grants: the categories this site actually declares.
       * A site with no marketing tracker leaves that category out of its copy,
       * and then neither the banner nor the proof log mentions it. */
      categories: (['essential', 'analytics', 'marketing'] as CategoryId[]).filter((id) => id in copy.categories),
      consent: consent ? { id: consent.id, at: consent.at } : null,
      granted: ['essential', ...(consent?.granted ?? [])],
      blockedAtEdge,
      cookies,
      locale,
      copy: {
        recordedOn: copy.recordedOn,
        reference: copy.reference,
        nothingRecorded: copy.nothingRecorded,
      },
    }) +
    ';'
  );
}

/**
 * Blocking by vendor domain, as well as by attribute.
 *
 * The attribute is the honest way: explicit, auditable, and it covers inline
 * snippets. But it means editing every page, and a site with thousands of them
 * does not want to. Matching `src` against a vendor list lets an existing site
 * be covered without touching its HTML at all, which is what makes a rollout
 * thinkable.
 *
 * It only reaches elements that have a URL. Inline snippets are invisible to
 * it, and that limit is structural rather than lazy: the Worker does not
 * execute JavaScript, so it cannot know what an inline script will load.
 */
function vendorCategory(src: string | null, vendors: Vendor[]): CategoryId | null {
  if (!src) return null;
  for (const v of vendors) if (src.includes(v.match)) return v.category;
  return null;
}

export function withConsent(response: Response, o: WithConsentOptions): Response {
  const { consent, vendors } = o;
  if (!(response.headers.get('Content-Type') || '').includes('text/html')) return response;

  /* Filled by the script handler as the document streams past. Because
   * HTMLRewriter visits nodes in document order, every script has been seen by
   * the time the </body> handler runs, which is why the report can be honest
   * about what the edge actually did on this request. */
  const blockedAtEdge: string[] = [];

  /* Injection must happen exactly once, and must happen even on malformed
   * markup. Measured: a page with no </body> never fired the end-tag
   * handler, so it shipped with the trackers blocked but NO banner and NO
   * runtime: permanently unconsentable. The document-end handler always
   * fires, so it is the backstop. */
  let injected = false;
  let locale = 'en';
  /* A visitor who already decided gets `banner === null` and the runtime
   * alone, which is the smaller payload. */
  const payload = () =>
    (o.banner ? o.banner(locale) : '') +
    '<script>' +
    stateScript(consent, o.policyVersion, blockedAtEdge, o.cookies, locale, o.copyFor(locale)) +
    RUNTIME +
    '</script>';

  return new o.HTMLRewriter()
    /* Read before anything else is emitted, and used by the handlers below:
     * HTMLRewriter visits in document order, so <html> is always seen first. */
    .on('html', {
      element(el) {
        locale = (el.getAttribute('lang') || 'en').slice(0, 2).toLowerCase();
      },
    })
    .on('script', {
      element(el) {
        const tagged = el.getAttribute('data-consent');
        const category = tagged ?? vendorCategory(el.getAttribute('src'), vendors);

        /* Untagged and from no known vendor: strictly necessary by default.
         * Defaulting the other way would break a site on its first deploy, and
         * a consent tool that breaks the site gets removed the same day. */
        if (!category) return;
        if (isGranted(consent, category)) return;

        /* Not `removeAttribute("src")`, and not deleting the node: an unknown
         * `type` is enough for the browser to skip the script *and* for the
         * preload scanner to leave the URL alone, while keeping everything the
         * client needs to revive it in place on consent. */
        const type = el.getAttribute('type');
        if (type) el.setAttribute('data-consent-type', type);
        el.setAttribute('type', 'text/plain');
        /* So the client runtime can revive it without knowing why it was
         * blocked: a vendor-matched script has no attribute of its own. */
        if (!tagged) el.setAttribute('data-consent', category);
        blockedAtEdge.push(category);
      },
    })
    /**
     * A tracker is not always a script.
     *
     * Tag managers ship a `<noscript><iframe src="…/ns.html?id=GTM-…">` that
     * fires for every visitor with JavaScript off. Pixels are `<img>`. And a
     * `<link rel=preconnect>` to a vendor opens the connection before anybody
     * has been asked anything.
     *
     * None of these can carry `type="text/plain"`, so the URL is parked in a
     * data attribute and the live one is emptied; the runtime puts it back.
     */
    .on('iframe, img', {
      element(el) {
        const src = el.getAttribute('src');
        const category = el.getAttribute('data-consent') ?? vendorCategory(src, vendors);
        if (!category || !src || isGranted(consent, category)) return;
        el.setAttribute('data-consent', category);
        el.setAttribute('data-consent-src', src);
        el.removeAttribute('src');
        blockedAtEdge.push(category);
      },
    })
    /**
     * `<noscript>` content is opaque to HTMLRewriter: the parser assumes
     * scripting is on, so an iframe inside it never matches the `iframe`
     * selector. Measured, it sailed straight through.
     *
     * But blanking does not require reading. Tagging the `<noscript>` itself is
     * enough, and that is one line in a layout rather than one per page. It is
     * one-way on purpose: a visitor with JavaScript on who consents gets the
     * real tag instead, and a visitor with JavaScript off cannot have consented
     * in the first place.
     */
    .on('noscript[data-consent]', {
      element(el) {
        const category = el.getAttribute('data-consent') as string;
        if (isGranted(consent, category)) return;
        el.setInnerContent('', { html: true });
        blockedAtEdge.push(category);
      },
    })
    .on('link[rel~="preconnect"], link[rel~="dns-prefetch"], link[rel~="preload"]', {
      element(el) {
        const href = el.getAttribute('href');
        const category = vendorCategory(href, vendors);
        if (!category || !href || isGranted(consent, category)) return;
        el.setAttribute('data-consent', category);
        el.setAttribute('data-consent-href', href);
        el.removeAttribute('href');
        blockedAtEdge.push(category);
      },
    })
    .on('head', {
      element(el) {
        el.prepend(headScript(consent, o.googleConsentMode), { html: true });
      },
    })
    .on('body', {
      element(el) {
        el.onEndTag((end) => {
          injected = true;
          end.before(payload(), { html: true });
        });
      },
    })
    /* The backstop. A page with no </body> never fires the handler above, and
     * measured it then shipped with the trackers blocked but NO banner and
     * NO runtime: blocked forever, with no way to consent. Document end always
     * fires. */
    .onDocument({
      end(end) {
        if (!injected) end.append(payload(), { html: true });
      },
    })
    .transform(response);
}
