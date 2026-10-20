import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE, createConsent, pageRequest } from '../src/index.ts';
import { cookieFor, html, makeConsent, render, request } from './helpers/site.mjs';

const post = (body, headers = {}, url = 'https://example.com/api/consent') =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'TestBrowser/1.0', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** A D1 stand-in that records what was bound, or throws. */
function fakeDb({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (fail) throw new Error('D1_ERROR: database is down');
              calls.push({ sql, values });
            },
          };
        },
      };
    },
  };
}

const silently = async (fn) => {
  const original = console.error;
  const lines = [];
  console.error = (line) => lines.push(line);
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
};

const consent = makeConsent();

test('headers: no ETag, no Last-Modified, private no-cache, Vary: Cookie', async () => {
  // The asset layer describes the FILE. The rewritten document is the visitor's own.
  const out = consent.applyConsent(
    request(),
    html(undefined, { etag: '"abc"', 'last-modified': 'Wed, 01 Jan 2031 00:00:00 GMT', 'cache-control': 'public, max-age=3600', vary: 'Accept-Encoding' }),
  );
  assert.equal(out.headers.get('etag'), null);
  assert.equal(out.headers.get('last-modified'), null);
  assert.equal(out.headers.get('cache-control'), 'private, no-cache');
  const vary = out.headers.get('vary').toLowerCase();
  assert.ok(vary.includes('cookie') && vary.includes('accept-encoding'), 'Vary keeps what was there');
});

test('pageRequest strips conditional validators, so the asset layer cannot answer 304', () => {
  // A 304 let the browser reuse the document rendered for the PREVIOUS choice:
  // a withdrawal reloaded the page and every tracker came back.
  const conditional = new Request('https://example.com/', {
    headers: { 'if-none-match': '"abc"', 'if-modified-since': 'Wed, 01 Jan 2031 00:00:00 GMT', cookie: 'a=1' },
  });
  const out = pageRequest(conditional);
  assert.equal(out.headers.get('if-none-match'), null);
  assert.equal(out.headers.get('if-modified-since'), null);
  assert.equal(out.headers.get('cookie'), 'a=1', 'everything else is kept');
  const plain = new Request('https://example.com/');
  assert.equal(pageRequest(plain), plain, 'nothing to strip, same object');
  assert.equal(consent.pageRequest, pageRequest);
});

test('POST /api/consent sets an HttpOnly cookie and answers with the decision', async () => {
  const res = await consent.handleConsentApi(post({ granted: ['analytics'], locale: 'en' }), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.granted, ['essential', 'analytics']);
  assert.match(body.id, /^[0-9a-f]{8}$/);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie.startsWith(COOKIE + '='));
  assert.match(setCookie, /HttpOnly/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('the cookie is set even when the proof insert throws (a visitor can always refuse)', async () => {
  const { result: res, lines } = await silently(() =>
    consent.handleConsentApi(post({ granted: [] }), { DB: fakeDb({ fail: true }) }),
  );
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('set-cookie').startsWith(COOKIE + '='));
  const logged = JSON.parse(lines[0]);
  assert.equal(logged.event, 'consent-proof-write-failed'); // the hole is shouted in the logs
  assert.match(logged.error, /database is down/);
});

test('works with no database bound: decisions are honoured and the missing log is reported', async () => {
  const { result: res, lines } = await silently(() => consent.handleConsentApi(post({ granted: ['marketing'] }), {}));
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(lines[0]).event, 'consent-proof-no-binding');
});

test('one row per decision, with a salted fingerprint and no IP', async () => {
  const db = fakeDb();
  const req = post({ granted: ['analytics', 'analytics', 'bogus', 'essential'], locale: 'fr-FR' }, { 'cf-connecting-ip': '203.0.113.9' });
  await consent.handleConsentApi(req, { DB: db, PROOF_SALT: 'salt-1' });
  assert.equal(db.calls.length, 1);
  const [id, site, at, policy, granted, country, client, locale] = db.calls[0].values;
  assert.equal(site, 'test-site');
  assert.equal(granted, 'analytics', 'deduplicated, unknown dropped, essential never stored');
  assert.equal(policy, 1);
  assert.equal(country, 'XX');
  assert.equal(locale, 'fr');
  assert.match(client, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(db.calls[0].values).includes('203.0.113.9'), 'no IP is stored');
  assert.ok(!JSON.stringify(db.calls[0].values).includes('TestBrowser'), 'no raw User-Agent is stored');
  assert.match(id, /^[0-9a-f]{8}$/);
  assert.ok(Number.isInteger(at));
  assert.match(db.calls[0].sql, /INSERT INTO consent_log/);

  // Same User-Agent, other salt: another fingerprint.
  await consent.handleConsentApi(post({ granted: [] }), { DB: db, PROOF_SALT: 'salt-2' });
  assert.notEqual(db.calls[1].values[6], client);
});

test('a refusal is stored as "-", never as an empty string', async () => {
  const db = fakeDb();
  await consent.handleConsentApi(post({ granted: [] }), { DB: db });
  assert.equal(db.calls[0].values[4], '-');
});

test('bad JSON is a 400, a GET is a 405, and other paths are left to the router', async () => {
  assert.equal((await consent.handleConsentApi(post('{nope'), {})).status, 400);
  const get = await consent.handleConsentApi(request(undefined, 'https://example.com/api/consent'), {});
  assert.equal(get.status, 405);
  assert.equal(await consent.handleConsentApi(request(undefined, 'https://example.com/about'), {}), null);
});

test('a body that is not the expected shape does not throw', async () => {
  const res = await consent.handleConsentApi(post({ granted: 'analytics', locale: 42 }), {});
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).granted, ['essential']);
});

test('GET /api/consent/banner renders in the asked language and reflects an existing choice', async () => {
  const fr = makeConsent({ copy: { fr: { accept: 'Tout accepter' } } });
  const res = await fr.handleConsentApi(request(cookieFor(['analytics']), 'https://example.com/api/consent/banner?locale=fr'), {});
  const text = await res.text();
  assert.match(text, /Tout accepter/);
  assert.match(text, /<input type="checkbox" value="analytics" checked>/);
  assert.match(text, /id="cc-banner"[^>]* hidden/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('policyVersion: bumping it invalidates stored choices and brings the banner back', async () => {
  const v2 = makeConsent({ policyVersion: 2 });
  const { text } = await render(v2, cookieFor(['analytics'], 'abc', 1, 1));
  assert.match(text, /id="cc-banner"/);
  const same = await render(v2, cookieFor(['analytics'], 'abc', 1, 2));
  assert.doesNotMatch(same.text, /id="cc-banner"/);
});

test('shared cookie Domain: only on the real domain, and the host-only cookie is expired', async () => {
  const shared = makeConsent({ cookieDomain: '.example.com' });
  const on = await shared.handleConsentApi(post({ granted: [] }, {}, 'https://docs.example.com/api/consent'), {});
  const cookies = on.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /Domain=\.example\.com/);
  assert.doesNotMatch(cookies[1], /Domain=/);
  assert.match(cookies[1], /Max-Age=0/);

  // localhost and *.workers.dev cannot take a Domain they do not belong to.
  for (const host of ['http://localhost:8787', 'https://preview-x.workers.dev', 'https://notexample.com']) {
    const res = await shared.handleConsentApi(post({ granted: [] }, {}, host + '/api/consent'), {});
    const set = res.headers.getSetCookie();
    assert.equal(set.length, 1, host);
    assert.doesNotMatch(set[0], /Domain=/, host);
  }
});

test('clearConsent erases the cookie (and the shared one) and redirects', () => {
  const shared = makeConsent({ cookieDomain: '.example.com', preferencesPath: '/privacy#prefs' });
  const res = shared.clearConsent(request(undefined, 'https://www.example.com/api/consent-reset'));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/privacy#prefs');
  const set = res.headers.getSetCookie();
  assert.equal(set.length, 2);
  assert.ok(set.every((c) => /Max-Age=0/.test(c)));
});

test('createConsent needs a site, and a Worker (or an injected HTMLRewriter) to run in', () => {
  assert.throws(() => createConsent({}), /site/);
  const bare = createConsent({ site: 'x' });
  assert.throws(() => bare.applyConsent(request(), html()), /HTMLRewriter/);
});

test('a body over 4 KB is a 413, on the declared length and on the bytes actually read', async () => {
  // The body is the visitor's: it was parsed uncapped before the proof write (security audit, 2026-10-19).
  const db = fakeDb();
  const big = { granted: [], locale: 'en', pad: 'x'.repeat(5000) };
  assert.equal((await consent.handleConsentApi(post(big), { DB: db })).status, 413);
  // A client that understates its Content-Length does not get past the cap.
  const lying = await consent.handleConsentApi(post(big, { 'content-length': '10' }), { DB: db });
  assert.equal(lying.status, 413);
  assert.equal(db.calls.length, 0);
  // A normal decision is far below it.
  assert.equal((await consent.handleConsentApi(post({ granted: ['analytics'], locale: 'fr' }), { DB: db })).status, 200);
  assert.equal(db.calls.length, 1);
});

test('JSON that is not an object ("null") is an empty decision, not a crash', async () => {
  const res = await consent.handleConsentApi(post('null'), {});
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).granted, ['essential']);
});
