#!/usr/bin/env node
/**
 * Fails the build if a third party can leave without consent.
 *
 *   node scripts/check-consent.mjs <dist-dir> [--markers markers.json] [--no-defaults]
 *
 * The edge only blocks what carries `data-consent` or whose URL is in
 * `vendors`. A snippet pasted from a new tool, unmarked, passes the build,
 * passes the deploy, and the banner keeps showing as if all were well. Nothing
 * else will say so. This is the counterpart: it looks for known third-party
 * signatures in the HTML a build produced and demands that their carrier is
 * marked.
 *
 * It is deliberately dumb. It does not understand JavaScript and does not try.
 * A false positive is silenced by adding the attribute, which is exactly what
 * should happen.
 *
 * Add a tool's signature HERE, before pasting its snippet into a layout, not
 * after.
 *
 * `--markers` takes a JSON file adding to (or, with --no-defaults, replacing)
 * the list below:
 *
 *   [{ "pattern": "cdn\\.example-tool\\.com|exampleTool\\(", "flags": "i",
 *      "name": "Example Tool", "category": "analytics" }]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--markers');

const DIST = positional[0];
if (!DIST) {
  console.error('usage: node scripts/check-consent.mjs <dist-dir> [--markers markers.json] [--no-defaults]');
  process.exit(2);
}

/* A tracker's inline snippet does not carry the vendor's URL in a `src`: that
 * is the whole problem. So what is recognised is what the snippet contains. */
const DEFAULT_MARKERS = [
  { re: /posthog\.init|posthog\.com|us\.i\.posthog/i, name: 'PostHog', category: 'analytics' },
  { re: /googletagmanager\.com|gtm\.start/i, name: 'Google Tag Manager', category: 'analytics' },
  { re: /google-analytics\.com|gtag\(/i, name: 'Google Analytics', category: 'analytics' },
  { re: /clarity\.ms/i, name: 'Microsoft Clarity', category: 'analytics' },
  { re: /hotjar\.com|hj\(/i, name: 'Hotjar', category: 'analytics' },
  { re: /cloud\.umami\.is|umami\.js/i, name: 'Umami', category: 'analytics' },
  { re: /cdn\.segment\.com|analytics\.load\(/i, name: 'Segment', category: 'analytics' },
  { re: /cdn\.mxpnl\.com|mixpanel\.init/i, name: 'Mixpanel', category: 'analytics' },
  { re: /snap\.licdn\.com|_linkedin_partner_id|lintrk/i, name: 'LinkedIn Insight', category: 'marketing' },
  { re: /px\.ads\.linkedin\.com/i, name: 'LinkedIn pixel', category: 'marketing' },
  { re: /connect\.facebook\.net|fbq\(/i, name: 'Meta pixel', category: 'marketing' },
  { re: /static\.ads-twitter\.com|twq\(/i, name: 'X pixel', category: 'marketing' },
  { re: /analytics\.tiktok\.com|ttq\./i, name: 'TikTok pixel', category: 'marketing' },
  { re: /googleadservices\.com|googlesyndication\.com/i, name: 'Google Ads', category: 'marketing' },
  { re: /js\.hs-scripts\.com|js\.hsforms\.net/i, name: 'HubSpot', category: 'marketing' },
  { re: /widget\.intercom\.io|Intercom\(/i, name: 'Intercom', category: 'marketing' },
  { re: /static\.cloudflareinsights\.com/i, name: 'Cloudflare Web Analytics', category: 'analytics' },
];

const custom = option('--markers')
  ? JSON.parse(readFileSync(option('--markers'), 'utf8')).map((m) => ({
      re: new RegExp(m.pattern, m.flags ?? 'i'),
      name: m.name,
      category: m.category,
    }))
  : [];
const MARKERS = flag('--no-defaults') ? custom : [...DEFAULT_MARKERS, ...custom];

/* What the Worker injects itself: it carries the consent state, not a tracker,
 * so it has nothing to be marked. */
const INJECTED_BY_WORKER = /window\.__consentState|window\.__consentGranted/;

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* htmlFiles(full);
    else if (entry.endsWith('.html')) yield full;
  }
}

/* Every possible carrier, with its attributes and its content. */
function* carriers(html) {
  const re = /<(script|noscript|iframe|img)\b([^>]*)>([\s\S]{0,4000}?)(?:<\/\1>|$)/gi;
  for (const m of html.matchAll(re)) yield { tag: m[1].toLowerCase(), attrs: m[2], body: m[3] };
}

const findings = [];
let scanned = 0;

for (const file of htmlFiles(DIST)) {
  scanned++;
  const html = readFileSync(file, 'utf8');
  for (const { tag, attrs, body } of carriers(html)) {
    const haystack = attrs + ' ' + body;
    if (INJECTED_BY_WORKER.test(haystack)) continue;
    if (/\btype=["']application\/ld\+json["']/i.test(attrs)) continue;

    for (const marker of MARKERS) {
      if (!marker.re.test(haystack)) continue;
      /* Marked, or already neutralised by the Worker in an output that was
       * already rewritten. */
      if (/\bdata-consent=/.test(attrs)) break;
      findings.push({ file, tag, name: marker.name, category: marker.category });
      break;
    }
  }
}

/* "Nothing to scan" is a failure, not a success: a wrong directory, or a build
 * that wrote its output somewhere else, must not turn this check green. */
if (scanned === 0) {
  console.error(`check-consent: no .html file under ${DIST}. Wrong directory, or the build wrote elsewhere.`);
  process.exit(1);
}

if (findings.length) {
  const unique = new Map();
  for (const f of findings) {
    const key = `${f.name}|${f.tag}`;
    if (!unique.has(key)) unique.set(key, { ...f, count: 0 });
    unique.get(key).count++;
  }
  console.error(`\nConsent: ${findings.length} unmarked third-party carrier(s) in ${scanned} page(s).\n`);
  for (const f of unique.values()) {
    console.error(`  ${f.name} in <${f.tag}>, ${f.count} page(s), for example ${f.file}`);
    console.error(`    Add data-consent="${f.category}" to the tag, or remove the third party.\n`);
  }
  console.error('An unmarked third party leaves before any consent: the edge blocks only what carries the attribute.\n');
  process.exit(1);
}

console.log(`check-consent: ok (${scanned} page(s), every known third party is marked)`);
