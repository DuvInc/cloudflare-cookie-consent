/** The key a limiter counts an address under: one IPv6 /64 is one caller (security audit, 2026-10-19). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitAddress, clientAddress } from '../src/client-address.ts';

test('IPv4 is unchanged, an IPv4-mapped IPv6 address collapses to it', () => {
  assert.equal(rateLimitAddress('203.0.113.7'), '203.0.113.7');
  assert.equal(rateLimitAddress('::ffff:203.0.113.7'), '203.0.113.7');
});

test('two addresses of one /64 share a key, two /64s do not', () => {
  assert.equal(rateLimitAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(rateLimitAddress('2001:0db8:0001:0002::1'), rateLimitAddress('2001:DB8:1:2:ffff:ffff:ffff:ffff'));
  assert.notEqual(rateLimitAddress('2001:db8:1:2::1'), rateLimitAddress('2001:db8:1:3::1'));
});

test('a leading or inner :: is expanded first, garbage passes through', () => {
  assert.equal(rateLimitAddress('::1'), '0:0:0:0::/64');
  assert.equal(rateLimitAddress('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(rateLimitAddress('unknown'), 'unknown');
  assert.equal(rateLimitAddress('zz:zz:zz:zz:zz:zz:zz:zz'), 'zz:zz:zz:zz:zz:zz:zz:zz');
});

test('clientAddress reads the edge header and says "unknown" without one', () => {
  assert.equal(clientAddress(new Request('https://x.test/', { headers: { 'cf-connecting-ip': '2001:db8:1:2::9' } })), '2001:db8:1:2::/64');
  assert.equal(clientAddress(new Request('https://x.test/')), 'unknown');
});
