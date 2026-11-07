#!/usr/bin/env node
/**
 * Writes `dist/`: the JavaScript a site actually loads.
 *
 *   node scripts/build.mjs          write dist/
 *   node scripts/build.mjs --check  fail if dist/ is not what src/ would produce
 *
 * The engine is written in TypeScript and Node strips types, so there is no
 * compiler here: Node's own `stripTypeScriptTypes` blanks the annotations out and
 * leaves every other character where it was. What changes is the import
 * specifiers (`./cookie.ts` becomes `./cookie.js`).
 *
 * Why `dist/` is committed and published to sites: Node refuses to strip types
 * from a file under `node_modules` (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING),
 * so a site's tests that import its Worker would fail on a package shipped as
 * `.ts`; and an install from a git tag has no build step to rely on. TypeScript
 * consumers still read the types from `src/` (see `exports` in package.json).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const check = process.argv.includes('--check');

const out = {};
for (const name of readdirSync(join(root, 'src')).filter((n) => n.endsWith('.ts'))) {
  const source = readFileSync(join(root, 'src', name), 'utf8');
  const js = stripTypeScriptTypes(source, { mode: 'strip' }).replace(/(from\s+['"]\.\/[\w-]+)\.ts(['"])/g, '$1.js$2');
  if (/\.ts['"]/.test(js)) throw new Error(`${name}: an import still points at a .ts file`);
  out[name.replace(/\.ts$/, '.js')] = js;
}

if (check) {
  const stale = Object.entries(out).filter(([name, js]) => {
    try {
      return readFileSync(join(root, 'dist', name), 'utf8') !== js;
    } catch {
      return true;
    }
  });
  const extra = readdirSync(join(root, 'dist')).filter((n) => !(n in out));
  if (stale.length || extra.length) {
    console.error(`dist/ is out of date (${[...stale.map(([n]) => n), ...extra].join(', ')}): run \`npm run build\` and commit it.`);
    process.exit(1);
  }
  console.log(`dist/ is in sync with src/ (${Object.keys(out).length} files).`);
} else {
  mkdirSync(join(root, 'dist'), { recursive: true });
  for (const [name, js] of Object.entries(out)) writeFileSync(join(root, 'dist', name), js);
  console.log(`dist/: ${Object.keys(out).length} files.`);
}
