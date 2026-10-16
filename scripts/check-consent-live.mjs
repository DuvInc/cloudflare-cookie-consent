#!/usr/bin/env node
/**
 * Consent, checked against a running site.
 *
 *   node scripts/check-consent-live.mjs <base-url> [options]
 *
 *   --paths /,/about,/pricing   pages to check (default /)
 *   --categories analytics,marketing
 *                               what the "accepted" visitor grants (default both)
 *   --policy-version 1          must match createConsent's policyVersion
 *   --expect-blocked 2          exact number of neutralised tags per page when
 *                               undecided. Without it: at least one.
 *   --allow-empty               pages with nothing to block are not a failure
 *   --no-404                    skip the "404 page is still consentable" check
 *
 * `check-consent.mjs` checks the BUILD: that every known third party carries
 * its attribute. This checks what is SERVED: that the Worker draws the right
 * consequences, on the real pages, in each consent state. A present attribute
 * does not prove it is honoured, and a block that works on one page says
 * nothing about the others. Neither replaces the other.
 *
 * Pin the expected count once you know it. When you add a marked third party
 * the count goes up and this says so: updating the number is the proof that
 * the new tag really is filtered.
 */
const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const flag = (name) => argv.includes(name);

const BASE = (argv.find((a, i) => !a.startsWith('--') && !String(argv[i - 1] ?? '').startsWith('--')) ?? '').replace(/\/$/, '');
if (!BASE) {
  console.error('usage: node scripts/check-consent-live.mjs <base-url> [--paths /,/about] [--expect-blocked N] [--allow-empty]');
  process.exit(2);
}

const PATHS = option('--paths', '/').split(',').map((p) => p.trim()).filter(Boolean);
const CATEGORIES = option('--categories', 'analytics,marketing').split(',').filter(Boolean);
const VERSION = option('--policy-version', '1');
const EXPECT = option('--expect-blocked') === undefined ? null : Number(option('--expect-blocked'));

const cookie = (granted) => `__consent=${encodeURIComponent([VERSION, granted.join(','), 'livecheck', 1893456000].join('~'))}`;
const ACCEPTED = cookie(CATEGORIES);
const REFUSED = cookie([]);

/* A browser User-Agent: bot protection answers 403 to a client that announces
 * itself as a script, and a 403 would look like an outage. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function get(path, cookieHeader, extra = {}) {
  const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', ...extra };
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(BASE + path, { headers, redirect: 'follow' });
  return { status: response.status, headers: response.headers, html: await response.text() };
}

/* Counts TAGS that were neutralised, not occurrences of a string: the client
 * runtime contains the selector twice, and counting with a naive grep once
 * produced a false failure. */
const blocked = (html) => {
  const scripts = [...html.matchAll(/<script([^>]*)>/gi)].filter((m) => m[1].includes('text/plain') && m[1].includes('data-consent')).length;
  const parked = [...html.matchAll(/<(?:img|iframe|link)\b([^>]*)>/gi)].filter((m) => /data-consent-(?:src|href)=/.test(m[1])).length;
  return scripts + parked;
};
const emptiedNoscripts = (html) =>
  [...html.matchAll(/<noscript[^>]*data-consent=[^>]*>([\s\S]*?)<\/noscript>/gi)].filter((m) => m[1].trim() === '').length;
const hasBanner = (html) => html.includes('id="cc-banner"');
const neutralised = (html) => blocked(html) + emptiedNoscripts(html);

let pass = 0;
const failures = [];
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
    console.log(`  \u001b[32mok\u001b[0m   ${name}`);
  } else {
    failures.push(name);
    console.log(`  \u001b[31mFAIL\u001b[0m ${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  }
};
const section = (t) => console.log(`\n\u001b[1m${t}\u001b[0m`);

console.log(`Consent, live: ${BASE}`);

section('No choice: tags are inert and the banner is in the document');
const baseline = {};
for (const path of PATHS) {
  const page = await get(path);
  const count = neutralised(page.html);
  baseline[path] = count;
  check(`${path} answers 200`, page.status, 200);
  if (EXPECT !== null) check(`${path}: ${EXPECT} neutralised tag(s)`, count, EXPECT);
  else if (flag('--allow-empty')) check(`${path}: has the banner`, hasBanner(page.html), true);
  /* "Nothing to block" must be a failure. A page that lost its trackers, a
   * Worker that stopped running, or a base URL that serves another site all
   * look exactly like this, and they look like success if empty is allowed. */
  else check(`${path}: at least one neutralised tag (nothing to block is a failure)`, count > 0, true);
  check(`${path}: banner present`, hasBanner(page.html), true);
  check(`${path}: runtime present`, page.html.includes('__consentState'), true);
}

section('Accepted: nothing blocked, no banner');
for (const path of PATHS) {
  const page = await get(path, ACCEPTED);
  check(`${path}: nothing neutralised, no banner`, [neutralised(page.html), hasBanner(page.html)], [0, false]);
}

section('Refused: same blocking as no choice, but no banner');
for (const path of PATHS) {
  const page = await get(path, REFUSED);
  check(`${path}: ${baseline[path]} neutralised, no banner`, [neutralised(page.html), hasBanner(page.html)], [baseline[path], false]);
}

section('A reload after a change of mind gets the new document, not a 304');
/* The page depends on the cookie, not only on the file. A 304 lets the browser
 * reuse the document rendered for the PREVIOUS choice: measured, a withdrawal
 * reloaded the page and every tracker came back. */
for (const path of PATHS) {
  const conditional = await get(path, REFUSED, { 'If-None-Match': '*', 'If-Modified-Since': 'Wed, 01 Jan 2031 00:00:00 GMT' });
  check(`${path}: a conditional request gets the document`, [conditional.status, neutralised(conditional.html)], [200, baseline[path]]);
}
const headers = (await get(PATHS[0])).headers;
check(
  'headers: no ETag, private no-cache, Vary: Cookie',
  [headers.get('etag'), headers.get('cache-control'), (headers.get('vary') || '').toLowerCase().includes('cookie')],
  [null, 'private, no-cache', true],
);
check('headers: no Last-Modified', headers.get('last-modified'), null);

if (!flag('--no-404')) {
  section('The 404 page is still consentable');
  const missing = await get('/__consent-check-does-not-exist');
  check('404 carries the runtime', [missing.status, missing.html.includes('__consentState')], [404, true]);
}

console.log(`\n${failures.length ? '\u001b[31m' : '\u001b[32m'}${pass} checks passed, ${failures.length} failed\u001b[0m`);
if (failures.length) {
  failures.forEach((f) => console.log('  FAIL ' + f));
  process.exit(1);
}
