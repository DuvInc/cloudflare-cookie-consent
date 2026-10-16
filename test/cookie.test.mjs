import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COOKIE,
  isGranted,
  parseConsent,
  readConsent,
  serializeConsent,
} from '../src/index.ts';
import { expireHostOnlyConsent, expireSharedConsent } from '../src/cookie.ts';

const req = (cookie) => new Request('https://example.com/', { headers: cookie ? { cookie } : {} });
const value = (v) => `${COOKIE}=${encodeURIComponent(v)}`;

test('serialize then read gives the same decision back', () => {
  const decision = { version: 1, granted: ['analytics', 'marketing'], id: 'k3f9x2', at: 1760000000 };
  const setCookie = serializeConsent(decision, true);
  const sent = setCookie.split(';')[0]; // what a browser sends back: name=value only
  assert.deepEqual(readConsent(req(sent)), decision);
});

test('the cookie is readable in devtools: version~categories~id~time', () => {
  const setCookie = serializeConsent({ version: 1, granted: ['analytics'], id: 'abc', at: 5 }, false);
  assert.equal(decodeURIComponent(setCookie.split(';')[0].slice(COOKIE.length + 1)), '1~analytics~abc~5');
});

test('flags: HttpOnly, SameSite=Lax, Secure only over https, Domain only when given', () => {
  const d = { version: 1, granted: [], id: 'x', at: 1 };
  const https = serializeConsent(d, true, '.example.com');
  assert.match(https, /HttpOnly/);
  assert.match(https, /SameSite=Lax/);
  assert.match(https, /; Secure/);
  assert.match(https, /Domain=\.example\.com/);
  const http = serializeConsent(d, false);
  assert.doesNotMatch(http, /Secure/);
  assert.doesNotMatch(http, /Domain=/);
  assert.match(http, /Max-Age=15724800/); // 182 days
});

test('two cookies sent (host-only and shared): the newest decision wins, whatever the order', () => {
  const older = value('1~analytics~old~100');
  const newer = value('1~~new~200');
  assert.equal(readConsent(req(`${older}; ${newer}`)).id, 'new');
  assert.equal(readConsent(req(`${newer}; ${older}`)).id, 'new');
});

test('a malformed cookie is "no choice", never an exception', () => {
  // `__consent=%%%%` was a 500 on every page before the try/catch.
  assert.equal(readConsent(req(`${COOKIE}=%%%%`)), null);
  assert.equal(readConsent(req(`${COOKIE}=`)), null);
  assert.equal(readConsent(req(`${COOKIE}=garbage`)), null);
  assert.equal(readConsent(req(value('1~analytics~')))?.id ?? null, null); // no id
  assert.equal(readConsent(req()), null);
});

test('a stale policy version re-opens the banner', () => {
  const stale = req(value('1~analytics~abc~100'));
  assert.equal(readConsent(stale, 1).id, 'abc');
  assert.equal(readConsent(stale, 2), null);
  assert.equal(parseConsent(encodeURIComponent('2~analytics~abc~100'), 2).version, 2);
});

test('unknown categories in the cookie are dropped', () => {
  const c = readConsent(req(value('1~analytics,evil,marketing~abc~1')));
  assert.deepEqual(c.granted, ['analytics', 'marketing']);
});

test('other cookies on the request do not interfere', () => {
  const c = readConsent(req(`a=1; ${value('1~analytics~abc~7')}; b=2; ${COOKIE}x=1`));
  assert.equal(c.id, 'abc');
});

test('isGranted: essential is always granted, the rest needs a decision', () => {
  assert.equal(isGranted(null, 'essential'), true);
  assert.equal(isGranted(null, 'analytics'), false);
  const c = { version: 1, granted: ['analytics'], id: 'x', at: 1 };
  assert.equal(isGranted(c, 'analytics'), true);
  assert.equal(isGranted(c, 'marketing'), false);
});

test('expiring: host-only and shared cookies are different cookies', () => {
  assert.doesNotMatch(expireHostOnlyConsent(true), /Domain=/);
  assert.match(expireSharedConsent(true, '.example.com'), /Domain=\.example\.com/);
  assert.match(expireHostOnlyConsent(false), /Max-Age=0/);
});
