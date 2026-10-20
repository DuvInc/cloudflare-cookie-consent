# AGENTS.md

Instructions for any AI agent working in this repository. One file, no
per-vendor copy: Claude Code, Cursor, Codex and the rest all read `AGENTS.md`.

Most rules below exist because the failure they prevent is silent. A tracker
that leaves without consent looks like a working banner. A cached document looks
like a fast page. A missing proof row looks like a quiet day. Nobody notices
until somebody audits.

## What this repository is

A Cloudflare Worker engine that applies cookie consent at the edge. The consent
cookie is first-party, so it is on the request; the Worker rewrites the HTML
stream with HTMLRewriter so every tag the visitor has not allowed leaves already
inert (`type="text/plain"`), injects the banner and a ~2 KB runtime, records one
row per decision in an optional D1 table, and never lets a logging failure stop a
refusal.

```text
request + __consent cookie -> pageRequest -> asset layer -> applyConsent (HTMLRewriter)
                                                              |
                          POST /api/consent -> Set-Cookie + one D1 row (optional)
```

The engine in `src/` is the product, and it is a function of a config object
(`createConsent(config)`), never a module that imports a site's config. `example/`
is a deployable fixture. `scripts/` are the two guards. `test/` runs without a
network.

## Layout

| Path | What it is |
| :--- | :--- |
| `src/service.ts` | `createConsent(config, deps)` returning `{ handleConsentApi, clearConsent, pageRequest, applyConsent }`. The API routes, the D1 write, the response headers |
| `src/rewrite.ts` | `withConsent`: the HTMLRewriter transform, the head script (Consent Mode), the state object. The only place tags are blocked |
| `src/cookie.ts` | `__consent`: parse, serialize, expire. Pure |
| `src/runtime.ts` | the browser script, as a string (`RUNTIME_SOURCE`) and without its comments (`RUNTIME`) |
| `src/ui.ts` | the banner markup and its CSS, from a copy and a theme. Pure |
| `src/config.ts` | built-in English copy, `COPY_FR` as an example, theme defaults, `resolveCopy`, `resolveTheme` |
| `src/client-address.ts` | the key a limiter counts an address under: IPv4 as is, an IPv6 address by its /64. Pure |
| `src/types.ts` | every type. Structural stand-ins for `D1Database` and `HTMLRewriter`, so there is no `@cloudflare/workers-types` dependency |
| `src/index.ts` | the public exports |
| `migrations/0001_consent_log.sql` | the proof log schema |
| `scripts/check-consent.mjs` | build guard: a known third party without `data-consent` fails |
| `scripts/check-consent-live.mjs` | checks served HTML in each consent state, headers, 304, the 404 page |
| `example/` | a two-page site, `worker/index.ts`, `wrangler.jsonc`. Runs with `npx wrangler dev`. wrangler is a devDependency here only |
| `test/` | 65 tests, no network, no key. `helpers/html-rewriter.mjs` stands in for HTMLRewriter |
| `skills/cloudflare-cookie-consent/SKILL.md` | the procedure for adding a third party, as a skill |
| `docs/` | `hero.png`, `banner.png` for the README |

## Commands

```bash
npm test               # no network, no key, no npm install needed
npm run check          # every script and test file parses
npm run example        # installs wrangler in example/ and serves http://localhost:8787
npm run check:example  # (second terminal) the live check against the real HTMLRewriter
```

Node 22.18 or newer runs the `.ts` files directly by stripping types. Nothing is
compiled. To type-check without adding a dependency:
`npx -p typescript@5 tsc -p .` (the repo's `tsconfig.json` is strict).

**README images.** `docs/banner.png` is a real screenshot of `npm run example`
with no choice made, framed on a dithered background; `docs/hero.png` and
`.github/social-preview.png` are generated banners (the social preview is
uploaded by hand in the repository settings). To retake the screenshot:

```bash
npm run example &   # http://localhost:8787, then /api/consent-reset
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1100,720 --virtual-time-budget=5000 \
  --screenshot=banner-raw.png http://localhost:8787/
```

Never retouch the page itself: a screenshot that does not match what the
example serves is worse than none.

## The rules

1. **`src/` has no dependency and no network call.** Not `fetch`, not a package.
   Transports and the rewriter are arguments (`deps.HTMLRewriter`, `env.DB`).
   That is what makes the tests free and the engine copyable into any Worker.
2. **The config is an argument, never an import.** Do not add a module the engine
   imports for site values. A site's declarations are one object in its own repo.
3. **Pages go through `pageRequest` and `applyConsent`, in that order.**
   `pageRequest` strips `If-None-Match` and `If-Modified-Since` so the asset layer
   cannot answer 304; `applyConsent` removes `ETag` and `Last-Modified`, sets
   `Cache-Control: private, no-cache` and `Vary: Cookie`. Never put a cache on this
   HTML: it depends on a cookie. A test and the live check pin it.
4. **A logging failure never blocks a decision.** The cookie is set whether or not
   the D1 insert worked, and the failure is logged as `consent-proof-write-failed`.
   The D1 binding is optional; without it the Worker logs
   `consent-proof-no-binding`.
5. **One row per decision, never per page view. No IP, no raw User-Agent.** The
   fingerprint is a salted, truncated hash. Do not store more.
6. **The schema comes from `migrations/`, never from `CREATE TABLE IF NOT EXISTS`
   in the handler.** That form does nothing when the table exists with other
   columns, so a schema change goes unnoticed until the first INSERT fails.
7. **The cookie is input from an attacker.** Parsing never throws: a malformed
   value is "no choice". A stale `policyVersion` is "no choice" too, so the banner
   asks again. Two `__consent` cookies on one request (host-only and shared): the
   newest decision wins.
8. **Untagged and from no known vendor is strictly necessary.** Blocking by
   default breaks a site on its first deploy.
9. **Neutralise, never delete.** A blocked script keeps `src`, attributes and body
   with `type="text/plain"` (and its original `type` in `data-consent-type`), so
   the runtime can revive it in place. Other carriers park their URL in
   `data-consent-src` or `data-consent-href`. A `<noscript>` is emptied: its
   content is opaque to HTMLRewriter.
10. **The runtime is a template literal with three rules: no backslash, no
    backtick, no `${`.** A backslash is swallowed, so a regex escape ships as the
    bare letter and silently matches nothing: parse by splitting. A test checks.
    `RUNTIME` is the source minus comments and indentation, newlines kept.
11. **The state object is inline JSON in a `<script>`.** `<` is escaped so the copy
    can never end the tag. Keep it that way if you add fields.
12. **A withdrawal reloads the page, a grant does not.** Deleting a cookie removes
    nothing while the tracker's SDK still runs and sets it again. The next document
    comes from the server with everything neutralised. The sweep also runs on every
    load, because that is when nothing runs.
13. **The sweep erases cookies and `localStorage` keys by prefix**, trying every
    parent-domain suffix. Categories that are never granted (conventionally
    `retired`) are swept on every page.
14. **A live check that finds nothing to block is a failure.** Do not add an
    "allow empty" default.
15. **Copy is HTML, from the config, trusted.** Never feed a visitor-controlled
    value into it.
16. **No em dashes** in code, comments, documentation or output. English only. No
    personal paths, no real site keys, no real tokens.

## Things that bite

- **The tests do not run Cloudflare's parser.** `test/helpers/html-rewriter.mjs`
  is a regex tokenizer. A change to `src/rewrite.ts` is not verified until
  `npm run example` and `npm run check:example` pass against the real
  HTMLRewriter.
- **Node strips types, it does not compile them.** No enums, no parameter
  properties, no namespaces. Imports of `.ts` files keep their extension.
- **`run_worker_first` must be "everything minus the assets".** A list of pages
  silently leaves some without a banner. The example's `wrangler.jsonc` documents
  it.
- **`wrangler dev` keeps a stale asset manifest after `rm -rf` of the output
  folder.** Restart it after a rebuild.
- **Cookies ignore the port.** On `localhost`, another project's dev server may
  have left `__consent` behind. Use `/api/consent-reset` before testing.
- **The `.workers.dev` and `localhost` hosts cannot take a `Domain=` cookie.** The
  engine applies `cookieDomain` only when the request is on that domain; otherwise
  the choice would silently never be saved.
- **Cloudflare Web Analytics injects its beacon after the Worker.** It is invisible
  to the build guard and to `applyConsent`. Set the site to `lite` mode.
- **The build guard has a hole by design:** a third party whose signature is not in
  its list. Add the signature before pasting a snippet, not after.
- **A framework that compiles scripts can drop attributes.** Astro's `define:vars`
  discarded `data-consent`. Use `is:inline` and pass values as `data-*`.

## Rules for agents

- **Do not create the GitHub repository, push, or deploy** without being asked.
  The example's `wrangler.jsonc` carries a placeholder database id on purpose.
- **Do not write to a production D1 database to test.** Use `wrangler dev` and its
  local database (`npm run example`).
- **Do not add a dependency.** `wrangler` in `example/` is the only one.
- **Do not commit a real consent log row, a real salt, or a real site's config.**
- **Never mark a third party as `essential`.**
- **Nothing here is legal advice.** Do not write copy that says a configuration is
  compliant.
- **Adding a third party to a site that uses this engine:** follow
  `skills/cloudflare-cookie-consent/SKILL.md`.
