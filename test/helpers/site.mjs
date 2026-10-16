import { createConsent } from '../../src/index.ts';
import { FakeHTMLRewriter } from './html-rewriter.mjs';

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<title>Test</title>
<link rel="preconnect" href="https://cdn.vendor-a.test">
<script>window.essential = true;</script>
<script data-consent="analytics">window.analytics = true;</script>
<script async src="https://t.vendor-a.test/tag.js"></script>
<script type="module" data-consent="analytics" src="/mod.js"></script>
</head>
<body>
<h1>Hello</h1>
<img src="https://px.vendor-b.test/p.gif" width="1" height="1">
<noscript data-consent="marketing"><img src="https://px.vendor-b.test/ns.gif"></noscript>
</body>
</html>`;

export const CONFIG = {
  site: 'test-site',
  vendors: [
    { match: 't.vendor-a.test', category: 'analytics' },
    { match: 'cdn.vendor-a.test', category: 'analytics' },
    { match: 'px.vendor-b.test', category: 'marketing' },
  ],
  cookies: { analytics: ['_a_id'], retired: ['_old'] },
};

export const makeConsent = (config = {}) => createConsent({ ...CONFIG, ...config }, { HTMLRewriter: FakeHTMLRewriter });

export const html = (body = PAGE, headers = {}) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

export const request = (cookie, url = 'https://example.com/') =>
  new Request(url, { headers: cookie ? { cookie } : {} });

export const cookieFor = (granted, id = 'abc', at = 1760000000, version = 1) =>
  `__consent=${encodeURIComponent([version, granted.join(','), id, at].join('~'))}`;

/** Every opening <script ...> tag of a document, as its attribute string. */
export const scriptTags = (doc) => [...doc.matchAll(/<script([^>]*)>/gi)].map((m) => m[1]);
export const blockedScripts = (doc) => scriptTags(doc).filter((a) => a.includes('text/plain'));

export async function render(consent, cookie, page = PAGE) {
  const out = consent.applyConsent(request(cookie), html(page));
  return { response: out, text: await out.text() };
}
