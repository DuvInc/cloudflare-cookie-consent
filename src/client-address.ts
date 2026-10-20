/**
 * The key a rate limiter counts a connecting address under.
 *
 * An IPv6 subscriber is handed a whole /64 (2^64 addresses), so counting each
 * address separately lets one machine rotate through a fresh key per request and
 * never meet a limit (security audit, 2026-10-19). The /64 is the unit: IPv4 is
 * unchanged, an IPv4-mapped IPv6 address collapses to its IPv4, any other IPv6
 * address becomes its first four hextets.
 */
export function rateLimitAddress(ip: string): string {
  if (!ip.includes(':')) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  const halves = ip.split('::');
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return ip;
  const groups = halves.length === 1 ? head : [...head, ...Array<string>(missing).fill('0'), ...tail];
  const prefix = groups.slice(0, 4);
  if (!prefix.every((h) => /^[0-9a-f]{1,4}$/i.test(h))) return ip;
  return `${prefix.map((h) => parseInt(h, 16).toString(16)).join(':')}::/64`;
}

/** The address a request came from, as Cloudflare reports it, reduced to what is counted. */
export const clientAddress = (request: Request): string => {
  const ip = request.headers.get('cf-connecting-ip');
  return ip ? rateLimitAddress(ip) : 'unknown';
};
