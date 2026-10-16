import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME, RUNTIME_SOURCE } from '../src/runtime.ts';

test('the runtime source has no backslash, backtick or dollar-brace', () => {
  // It lives in a template literal: a backslash is swallowed, so a regex escape
  // once shipped as the bare letter and silently matched nothing.
  assert.ok(!RUNTIME_SOURCE.includes('\\'));
  assert.ok(!RUNTIME_SOURCE.includes('${'));
  assert.ok(!RUNTIME_SOURCE.includes('`'));
});

test('the shipped runtime is valid JavaScript and cannot end its own <script>', () => {
  assert.doesNotThrow(() => new Function(RUNTIME));
  assert.ok(!/<\/script/i.test(RUNTIME), 'a </script> inside would end the inline tag early');
});

test('comments are stripped from what ships, and it stays small', () => {
  assert.ok(!RUNTIME.includes('/*'));
  assert.ok(RUNTIME.length < RUNTIME_SOURCE.length / 1.5);
  assert.ok(RUNTIME.length < 8 * 1024);
});

test('it talks to the two routes the Worker serves, and exposes the client bridge', () => {
  assert.match(RUNTIME, /\/api\/consent'/);
  assert.match(RUNTIME, /\/api\/consent\/banner\?locale=/);
  assert.match(RUNTIME, /window\.cookieConsent=/);
  assert.match(RUNTIME, /'cookie-consent'/);
  assert.match(RUNTIME, /cc-preferences/);
});

test('a withdrawal reloads the page, a grant does not', () => {
  assert.match(RUNTIME, /if\(lost\.length\)location\.reload\(\)/);
});
