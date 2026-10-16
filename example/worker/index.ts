import { COPY_FR, createConsent, type ConsentEnv } from '../../src/index.ts';

/**
 * Everything this site declares about its cookies, in one object. It is code,
 * not a database: a file under version control gets read in a pull request,
 * and a value in a store does not.
 */
const consent = createConsent({
  // The key of this site in the proof log. One D1 database can serve many sites.
  site: 'example',

  // A belt: third parties recognised by the URL they load. The `data-consent`
  // attribute is what does the work; this catches a tag that arrives with a
  // `src` and was never marked.
  vendors: [
    { match: 'analytics.example.test', category: 'analytics' },
    { match: 'pixel.example.test', category: 'marketing' },
  ],

  // What to erase when a category is not granted. Exact cookie names, plus
  // localStorage keys by prefix. `retired` is never offered and so never
  // granted: the leftovers of a tool you removed are swept on every page.
  cookies: {
    analytics: ['fake_analytics_id'],
    marketing: ['fake_pixel_id'],
    retired: ['_old_tool'],
  },

  // English is built in. A language you do not list falls back to it.
  copy: {
    en: { body: 'This demo site pretends to use analytics and marketing cookies. Decline and nothing loads.' },
    fr: COPY_FR,
  },

  theme: { accent: '#0b6b4f', accentText: '#ffffff' },
});

type Env = ConsentEnv & { ASSETS: { fetch(request: Request): Promise<Response> } };

/** A document, as opposed to an asset: no file extension. */
const isPage = (pathname: string) => !/\.[a-z0-9]+$/i.test(pathname);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // The consent routes come first: they are neither pages nor assets.
    if (pathname.startsWith('/api/consent')) {
      // A testing helper: erases the choice and goes to the preferences page.
      // Cookies ignore the port, so on localhost run it before testing another site.
      if (pathname === '/api/consent-reset') return consent.clearConsent(request);
      const handled = await consent.handleConsentApi(request, env);
      if (handled) return handled;
    }

    if (!isPage(pathname)) return env.ASSETS.fetch(request);

    // pageRequest: no conditional headers, so the asset layer cannot answer 304
    // and let the browser reuse a document rendered for the previous choice.
    const asset = await env.ASSETS.fetch(consent.pageRequest(request));

    // applyConsent: the only place consent touches a served page. A 404 is
    // included, because the 404 page has the same layout and the same trackers.
    // A redirect or a 304 is passed through untouched.
    return asset.ok || asset.status === 404 ? consent.applyConsent(request, asset) : asset;
  },
};
