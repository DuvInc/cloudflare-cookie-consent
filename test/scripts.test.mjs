import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConsent } from './helpers/site.mjs';

const run = (script, ...args) =>
  spawnSync(process.execPath, [new URL(`../scripts/${script}`, import.meta.url).pathname, ...args], { encoding: 'utf8' });

function dist(files) {
  const dir = mkdtempSync(join(tmpdir(), 'consent-dist-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test('check-consent: a known third party with no data-consent fails the build', () => {
  const dir = dist({ 'index.html': '<html><body><script>posthog.init("key")</script></body></html>' });
  try {
    const r = run('check-consent.mjs', dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /PostHog/);
    assert.match(r.stderr, /data-consent="analytics"/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('check-consent: the same snippet, marked, passes', () => {
  const dir = dist({
    'index.html': '<html><body><script data-consent="analytics">posthog.init("key")</script></body></html>',
    'deep/page.html': '<html><body><noscript data-consent="marketing"><img src="https://px.ads.linkedin.com/x"></noscript></body></html>',
  });
  try {
    const r = run('check-consent.mjs', dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 page/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('check-consent: an empty directory is a failure, not a green check', () => {
  const dir = dist({ 'notes.txt': 'nothing here' });
  try {
    assert.equal(run('check-consent.mjs', dir).status, 1);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('check-consent: --markers adds your own signature', () => {
  const dir = dist({ 'index.html': '<html><body><script src="https://cdn.example-tool.test/t.js"></script></body></html>' });
  const markers = join(dir, 'markers.json');
  writeFileSync(markers, JSON.stringify([{ pattern: 'example-tool\\.test', name: 'Example Tool', category: 'analytics' }]));
  try {
    assert.equal(run('check-consent.mjs', dir).status, 0, 'unknown without the marker');
    const r = run('check-consent.mjs', dir, '--markers', markers);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Example Tool/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

/* A real HTTP server around the engine, playing the part of the Worker plus the
 * asset layer. It lets the live check run end to end with no network. */
const PAGE = `<!doctype html><html lang="en"><head><title>t</title></head><body>
<script data-consent="analytics">window.a=1</script>
<noscript data-consent="marketing"><img src="https://px.example.test/p.gif"></noscript>
</body></html>`;

function serve({ usePageRequest = true, keepValidators = false, page = PAGE } = {}) {
  const consent = makeConsent();
  const server = createServer(async (req, res) => {
    const request = new Request('http://localhost' + req.url, { headers: req.headers });
    const forAssets = usePageRequest ? consent.pageRequest(request) : request;
    // The asset layer: it answers 304 to a conditional request, like the real one.
    const missing = req.url.startsWith('/__consent-check');
    const asset = forAssets.headers.has('if-none-match')
      ? new Response(null, { status: 304 })
      : new Response(page, { status: missing ? 404 : 200, headers: { 'content-type': 'text/html', etag: '"v1"', 'last-modified': 'Wed, 01 Jan 2031 00:00:00 GMT' } });
    let out = asset.status === 304 ? asset : consent.applyConsent(request, asset);
    if (keepValidators && out.status === 200) {
      const h = new Headers(out.headers);
      h.set('etag', '"v1"');
      out = new Response(out.body, { status: 200, headers: h });
    }
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const runAsync = (script, ...args) =>
  new Promise((resolve) => {
    import('node:child_process').then(({ execFile }) =>
      execFile(process.execPath, [new URL(`../scripts/${script}`, import.meta.url).pathname, ...args], (error, stdout, stderr) =>
        resolve({ status: error ? error.code : 0, stdout, stderr }),
      ),
    );
  });

test('check-consent-live: a correct Worker passes every check', async () => {
  const { server, url } = await serve();
  try {
    const r = await runAsync('check-consent-live.mjs', url, '--expect-blocked', '2');
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /0 failed/);
  } finally {
    server.close();
  }
});

test('check-consent-live: forgetting pageRequest (a 304 resurrects trackers) is caught', async () => {
  const { server, url } = await serve({ usePageRequest: false });
  try {
    const r = await runAsync('check-consent-live.mjs', url);
    assert.equal(r.status, 1, 'a 304 on a conditional request must fail the check');
    assert.match(r.stdout, /conditional request/);
  } finally {
    server.close();
  }
});

test('check-consent-live: a leaked ETag is caught', async () => {
  const { server, url } = await serve({ keepValidators: true });
  try {
    const r = await runAsync('check-consent-live.mjs', url);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no ETag/);
  } finally {
    server.close();
  }
});

test('check-consent-live: a pinned count that no longer matches is caught', async () => {
  const { server, url } = await serve();
  try {
    assert.equal((await runAsync('check-consent-live.mjs', url, '--expect-blocked', '5')).status, 1);
  } finally {
    server.close();
  }
});

test('check-consent-live: nothing to block is a failure unless --allow-empty', async () => {
  // A page that lost its trackers, a Worker that stopped running, or a base URL
  // serving another site all look like this, and look like success if empty is allowed.
  const { server, url } = await serve({ page: '<!doctype html><html lang="en"><head></head><body><p>clean</p></body></html>' });
  try {
    const strict = await runAsync('check-consent-live.mjs', url);
    assert.equal(strict.status, 1);
    assert.match(strict.stdout, /nothing to block is a failure/);
    assert.equal((await runAsync('check-consent-live.mjs', url, '--allow-empty')).status, 0);
  } finally {
    server.close();
  }
});
