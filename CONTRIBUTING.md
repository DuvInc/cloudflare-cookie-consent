# Contributing

Thanks for looking. This is a one-person project maintained on a best-effort
basis, so the most useful thing you can do before writing code is open an
issue. A small fix is always welcome; a large one is worth agreeing on first.

## Getting set up

Node 22.18 or newer (it runs `.ts` files natively, by stripping the types).

```bash
npm test               # no network, no key, no npm install needed
npm run check          # every script parses
```

`npm test` passes on a fresh clone with nothing installed. If it does not, that
is a bug worth reporting on its own.

To exercise the real path you need nothing from Cloudflare: wrangler runs the
example locally, with a local D1 database.

```bash
npm run example        # installs wrangler in example/, serves http://localhost:8787
npm run check:example  # in another terminal: the live check against it
```

## Sign your commits off

Every commit needs a `Signed-off-by` line, which certifies that you wrote the
patch or otherwise have the right to submit it under the MIT licence. This is
the [Developer Certificate of Origin](https://developercertificate.org): one
line, no paperwork, no copyright assignment.

```bash
git commit -s -m "Your message"
```

## What makes a change likely to be merged

**A change to the rewrite, the headers or the cookie comes with a test.**
`src/rewrite.ts`, `src/service.ts` and `src/cookie.ts` are where a tracker would
leak silently. Several tests exist because of a bug that shipped once; if you
change what is blocked, released or cached, add the case that shows the new
behaviour.

**The tests use a stand-in for HTMLRewriter.** `test/helpers/html-rewriter.mjs`
is a small tokenizer, right for well-formed documents and nothing more. So a
change to the rewrite also needs `npm run example` and `npm run check:example`
against the real one. Say in the PR that you ran them.

**The engine stays dependency-free.** `src/` imports nothing from npm and makes
no network call. wrangler is a dev dependency of `example/` only. Anything else
needs an argument in an issue.

**The runtime string keeps its rules.** It is a template literal: no backslash,
no backtick, no `${`. `test/runtime.test.mjs` checks.

**Node runs the source directly.** Avoid TypeScript-only runtime syntax (enums,
parameter properties, namespaces): types are stripped, nothing is compiled.

**Comments explain why, not what.** The existing ones are long on purpose: they
record what went wrong before.

**No em dashes**, anywhere.

## Reporting a bug

Include the commit, what you ran, the consent state you were in, and the HTML
the Worker sent (`curl` it with the cookie), not what the browser showed after
scripts ran. Most leaks are visible there first.

Do not paste a secret or a real visitor's consent reference. For anything with
security implications, read [SECURITY.md](./SECURITY.md) instead of opening a
public issue.
