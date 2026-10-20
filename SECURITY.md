# Security policy

## Reporting a vulnerability

Please report privately rather than in a public issue, using GitHub's
[private vulnerability reporting](https://github.com/DuvInc/cloudflare-cookie-consent/security/advisories/new)
on this repository.

This is a one-person project. You should get an acknowledgement within a few
days; if a week passes with no reply, feel free to nudge by opening a public
issue that says only that you are waiting on a private report, with no details.

## What is in scope

A Worker that sits in front of every page of a site, reads a cookie an attacker
can set, writes to a database, and injects markup into documents. The
interesting surface:

- **The cookie.** `__consent` is input from the visitor's browser. Anything a
  crafted value can do beyond "no choice" is in scope: an exception (it used to
  be a 500 on every page), a granted category the visitor never chose, a value
  that reaches the HTML, the database or the logs unescaped.
- **Markup injection.** The banner copy and the state object are inserted into
  the page. The copy comes from your config and is trusted, but a path where
  visitor-controlled data reaches it, or where the inline JSON can end its own
  `<script>`, is in scope.
- **The proof log.** No IP, no raw User-Agent, no per-page-view row. A change
  that starts storing more personal data is in scope, and so is an INSERT built
  by string concatenation.
- **A way around the block.** A tag form that a documented, marked carrier
  still lets through before consent, in any state of the cookie.
- **Cache poisoning.** A way to make one visitor's rewritten document be served
  to another: validators, `Cache-Control`, `Vary`.
- **`/api/consent`.** The body is capped at 4 KB and the proof rows are limited
  per address (see the README). A way around either, or a write amplification
  beyond one row per request, is in scope.

## What is out of scope

- Cloudflare itself: HTMLRewriter, static assets, D1. Report those to
  Cloudflare.
- Whether the banner satisfies a regulation. That is a legal question, not a
  vulnerability, and nothing here is legal advice.
- A visitor who forges their own cookie to grant themselves categories. They
  can also click "Accept all".
- Third-party tags that were never marked. The package blocks what you mark;
  `scripts/check-consent.mjs` exists to tell you what you forgot.
- A vulnerability that requires the attacker to already have access to your
  Cloudflare account or your repository.

## If you deployed this

Three things this repository cannot do for you:

- **Set `PROOF_SALT`.** The User-Agent fingerprint is salted with it
  (`wrangler secret put PROOF_SALT`). Without it, the salt is your site key,
  which is public.
- **Keep the proof log private.** It is evidence of what each visitor chose.
  Give the D1 database to whoever audits you, and to nobody else.
- **Check the served HTML, not the repository.** A tag injected after your
  Worker (a Cloudflare setting, a proxy) is invisible to everything here. Run
  `scripts/check-consent-live.mjs` against production.

## If you forked this tool

Replace the link above with your own repository. This file arrived with the
code and points at somebody else's advisories.
