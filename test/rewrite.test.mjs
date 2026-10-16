import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedScripts, cookieFor, makeConsent, PAGE, render, scriptTags } from './helpers/site.mjs';

const consent = makeConsent();

test('no choice: a marked script becomes text/plain and keeps what is needed to revive it', async () => {
  const { text } = await render(consent);
  const marked = scriptTags(text).find((a) => a.includes('window.analytics') || (a.includes('data-consent="analytics"') && !a.includes('src=')));
  assert.match(marked, /type="text\/plain"/);
  assert.match(marked, /data-consent="analytics"/);
});

test('no choice: an unmarked, unknown script is strictly necessary and stays live', async () => {
  const { text } = await render(consent);
  assert.match(text, /<script>window\.essential = true;<\/script>/);
});

test('no choice: a script matched only by its vendor URL is blocked and tagged for revival', async () => {
  const { text } = await render(consent);
  const vendor = scriptTags(text).find((a) => a.includes('t.vendor-a.test'));
  assert.match(vendor, /type="text\/plain"/);
  assert.match(vendor, /data-consent="analytics"/);
});

test('consent: the same document stays live', async () => {
  const { text } = await render(consent, cookieFor(['analytics', 'marketing']));
  assert.equal(blockedScripts(text).length, 0);
  assert.match(text, /<noscript data-consent="marketing"><img src="https:\/\/px\.vendor-b\.test\/ns\.gif"><\/noscript>/);
  assert.match(text, /<img src="https:\/\/px\.vendor-b\.test\/p\.gif"/);
});

test('categories are independent: analytics granted, marketing still blocked', async () => {
  const { text } = await render(consent, cookieFor(['analytics']));
  assert.equal(blockedScripts(text).length, 0);
  assert.match(text, /<noscript data-consent="marketing"><\/noscript>/);
  assert.doesNotMatch(text, /<img src="https:\/\/px\.vendor-b\.test\/p\.gif"/);
});

test('a <noscript> is emptied, not read (its content is opaque to the rewriter)', async () => {
  const { text } = await render(consent);
  assert.match(text, /<noscript data-consent="marketing"><\/noscript>/);
  assert.doesNotMatch(text, /ns\.gif/);
});

test('an <img> from a known vendor has its URL parked, and gets it back on consent', async () => {
  const { text } = await render(consent);
  const img = text.match(/<img [^>]*p\.gif[^>]*>/)[0];
  assert.match(img, /data-consent-src="https:\/\/px\.vendor-b\.test\/p\.gif"/);
  assert.doesNotMatch(img, / src=/);
});

test('a preconnect to a vendor does not open a connection before the choice', async () => {
  const { text } = await render(consent);
  const link = text.match(/<link [^>]*>/)[0];
  assert.doesNotMatch(link, / href=/);
  assert.match(link, /data-consent-href="https:\/\/cdn\.vendor-a\.test"/);
});

test('a <script type="module"> keeps its type for the revival', async () => {
  const { text } = await render(consent);
  const mod = scriptTags(text).find((a) => a.includes('/mod.js'));
  assert.match(mod, /type="text\/plain"/);
  assert.match(mod, /data-consent-type="module"/);
});

test('the banner and the runtime are injected before </body> for an undecided visitor', async () => {
  const { text } = await render(consent);
  assert.match(text, /id="cc-banner"/);
  assert.ok(text.indexOf('id="cc-banner"') < text.indexOf('</body>'));
  assert.match(text, /window\.__consentState=/);
});

test('a visitor who decided gets the runtime without the banner markup', async () => {
  const { text } = await render(consent, cookieFor([]));
  assert.doesNotMatch(text, /id="cc-banner"/);
  assert.match(text, /window\.__consentState=/);
});

test('a page with no </body> still gets the banner and runtime (document-end backstop)', async () => {
  const { text } = await render(consent, undefined, '<html lang="en"><head></head><p>no body end tag');
  assert.match(text, /id="cc-banner"/);
  assert.match(text, /window\.__consentState=/);
  assert.equal(text.match(/window\.__consentState=/g).length, 1, 'injected exactly once');
});

test('the banner speaks the language of <html lang>, with English as the fallback', async () => {
  const fr = makeConsent({ copy: { fr: { accept: 'Tout accepter' } } });
  const { text } = await render(fr, undefined, PAGE.replace('lang="en"', 'lang="fr-FR"'));
  assert.match(text, />Tout accepter</);
  const de = await render(fr, undefined, PAGE.replace('lang="en"', 'lang="de"'));
  assert.match(de.text, />Accept all</);
});

test('non-HTML responses pass through untouched', () => {
  const json = new Response('{"a":1}', { headers: { 'content-type': 'application/json', etag: '"x"' } });
  const out = consent.applyConsent(new Request('https://example.com/'), json);
  assert.equal(out.headers.get('etag'), '"x"');
});

test('state records what the edge blocked, and declared cookies reach the runtime', async () => {
  const { text } = await render(consent);
  const state = JSON.parse(text.match(/window\.__consentState=(.*?);\(function/s)[1]);
  assert.equal(state.consent, null);
  assert.deepEqual(state.granted, ['essential']);
  assert.ok(state.blockedAtEdge.includes('analytics') && state.blockedAtEdge.includes('marketing'));
  assert.deepEqual(state.cookies.retired, ['_old']);
});

test('a </script> in the banner copy cannot break out of the inline script', async () => {
  const hostile = makeConsent({ copy: { en: { recordedOn: 'x</script><img src=x onerror=alert(1)>' } } });
  const { text } = await render(hostile);
  assert.doesNotMatch(text, /<\/script><img src=x/);
  const state = JSON.parse(text.match(/window\.__consentState=(.*?);\(function/s)[1]);
  assert.equal(state.copy.recordedOn, 'x</script><img src=x onerror=alert(1)>'); // identical once parsed
});

test('accept-all grants only the categories the site declares', async () => {
  const noMarketing = makeConsent({
    copy: { en: { categories: { essential: { label: 'e', note: 'e' }, analytics: { label: 'a', note: 'a' } } } },
  });
  const { text } = await render(noMarketing);
  const state = JSON.parse(text.match(/window\.__consentState=(.*?);\(function/s)[1]);
  assert.deepEqual(state.categories, ['essential', 'analytics']);
  assert.doesNotMatch(text, /value="marketing"/);
});

test('Google Consent Mode is off by default and rendered from the cookie when on', async () => {
  const off = await render(consent);
  const headScript = off.text.match(/<head>\s*<script>(.*?)<\/script>/s)[1];
  assert.doesNotMatch(headScript, /dataLayer/); // the runtime mentions it, the head script must not create it
  assert.match(headScript, /window\.__consentGranted=\["essential"\]/);

  const gcm = makeConsent({ googleConsentMode: true });
  const undecided = (await render(gcm)).text;
  assert.match(undecided, /"analytics_storage":"denied"/);
  assert.match(undecided, /"wait_for_update":500/);
  const granted = (await render(gcm, cookieFor(['analytics']))).text;
  assert.match(granted, /"analytics_storage":"granted"/);
  assert.match(granted, /"ad_storage":"denied"/);
  assert.doesNotMatch(granted, /wait_for_update/);
});
