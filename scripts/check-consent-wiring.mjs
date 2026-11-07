#!/usr/bin/env node
/**
 * Fails when a site is not wired the way every site must be.
 *
 *   node node_modules/cloudflare-cookie-consent/scripts/check-consent-wiring.mjs \
 *     --wrangler wrangler.jsonc [--wrangler apps/docs/wrangler.jsonc ...] \
 *     [--package package.json] [--root .] [--root ../../shared] [--database duv-consent] [--bindings DB,CONSENT_DB]
 *
 * `--root` may be repeated: every folder scanned for a local copy of the engine.
 *
 * Three things go wrong here without a sound, which is why they are checked:
 *
 * 1. The proof log was "optional" and was never bound. The engine honours the
 *    visitor's choice without a database, so a site that never bound one looks
 *    exactly like a site that does: the only trace is a `consent-proof-no-binding`
 *    line in the logs. A site in production must name the database.
 * 2. The engine is imported, not copied. A copy is a fork that does not receive
 *    the next fix. Five copies of the engine had drifted apart before this check.
 * 3. The dependency must exist in the site's package.json, or the import only
 *    works by accident of a hoisted install.
 *
 * Exit 0 when everything holds, 1 with one line per problem otherwise.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const argv = process.argv.slice(2);
const many = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const one = (name, fallback) => many(name)[0] ?? fallback;

const wranglers = many('--wrangler');
const roots = (many('--root').length ? many('--root') : ['.']).map((r) => resolve(r));
const packagePath = resolve(one('--package', 'package.json'));
const database = one('--database', 'duv-consent');
const bindings = one('--bindings', 'DB,CONSENT_DB').split(',');
const engine = one('--engine', 'cloudflare-cookie-consent');

if (wranglers.length === 0) {
  console.error('usage: check-consent-wiring.mjs --wrangler <wrangler.jsonc> [--wrangler ...] [--package package.json] [--root dir]');
  process.exit(2);
}

/** wrangler.jsonc is JSON with comments and trailing commas. Strings are respected. */
function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i === -1) throw new Error('unterminated comment');
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const problems = [];

for (const file of wranglers) {
  const path = resolve(file);
  if (!existsSync(path)) {
    problems.push(`${file}: no such file`);
    continue;
  }
  let config;
  try {
    config = parseJsonc(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${file}: cannot be read as wrangler config (${error.message})`);
    continue;
  }
  const bound = (config.d1_databases ?? []).filter((d) => bindings.includes(d.binding) && d.database_name === database);
  if (bound.length === 0) {
    problems.push(
      `${file}: no D1 binding named ${bindings.join(' or ')} on database "${database}". Without it the proof of consent is ` +
        'silently not written (log event consent-proof-no-binding). Add it, as in the cookie-consent skill.',
    );
  } else if (bound.some((d) => !d.database_id)) {
    problems.push(`${file}: the "${database}" binding has no database_id`);
  }
}

/* The engine's own fingerprints. Any of them in a site's code means a copy. */
const SIGNATURES = [
  [/consent-proof-write-failed/, 'the proof-log write'],
  [/window\.(cookieConsent|duvConsent)\s*=\s*\{/, 'the browser runtime'],
  [/export function withConsent\s*\(\s*response/, 'the HTML rewriter'],
];
const SKIP = new Set(['node_modules', '.git', 'dist', '.wrangler', '.astro', '.next', '.open-next', '.turbo', 'coverage']);
const CODE = /\.(ts|tsx|js|mjs|cjs)$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) yield* files(full);
    else if (CODE.test(name) && info.size < 400_000) yield full;
  }
}

for (const root of roots) for (const file of files(root)) {
  const text = readFileSync(file, 'utf8');
  const hit = SIGNATURES.find(([re]) => re.test(text));
  if (hit) {
    problems.push(
      `${relative(process.cwd(), file)}: a local copy of the consent engine (${hit[1]}). Import ${engine} instead; ` +
        'a fix to the engine is made once, in its own repository.',
    );
  }
}

if (!existsSync(packagePath)) {
  problems.push(`${packagePath}: no such file`);
} else {
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!declared[engine]) problems.push(`${relative(process.cwd(), packagePath) || 'package.json'}: ${engine} is not a dependency`);
  else if (!/#[0-9a-f]{7,40}$|#v?\d+\.\d+\.\d+$|^\^?\d+\.\d+\.\d+$/.test(declared[engine])) {
    problems.push(`${engine} must be pinned to a tag or a commit (got "${declared[engine]}"), never a branch: a site changes engine version on purpose.`);
  }
}

if (problems.length) {
  for (const p of problems) console.error('x ' + p);
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''}.`);
  process.exit(1);
}
console.log(`consent wiring ok: ${wranglers.length} wrangler file${wranglers.length > 1 ? 's' : ''} on "${database}", ${engine} imported, no local copy.`);
