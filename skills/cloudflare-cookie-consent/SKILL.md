---
name: cloudflare-cookie-consent
description: Add, change or remove a third party (analytics, pixel, chat, heatmap, video player, external font, pasted snippet) on a site that applies cookie consent at the edge with cloudflare-cookie-consent, or put that engine on a new site. Read BEFORE pasting a snippet into a layout, adding an iframe or an external font, and before deploying. Covers marking with data-consent, the two guards, the config, and the failures already paid. Not for writing a privacy policy's legal text.
---

# Cookie consent at the edge: marking what you add

> **Every third party added to the site must be marked, or it leaves for
> everyone, with no consent, and nothing says so.** The Worker blocks only what
> carries `data-consent` or whose URL matches `vendors`. An unknown tool pasted as
> is passes the build, passes the deploy, and the banner keeps showing as if all
> were well.

The procedure. The reasoning is in `AGENTS.md`, the failures already paid in the
README's "Things that bite".

## When to use it

Whenever a task adds, changes or removes something that loads code or resources
from another domain: analytics, an ad pixel, a chat widget, a heatmap, an A/B test,
a video player, a font or image served by a third party, a "copy and paste" snippet
from a new tool. Also to put the engine on a new site.

## Adding a third party

1. **Pick the category.** `analytics` (audience measurement, heatmaps, replay) or
   `marketing` (ads, retargeting, third-party chat, pixels). If unsure,
   `marketing`. `essential` is never for a third party.
2. **Add its signature to the build guard first**, before pasting the snippet: a
   JSON entry `{ "pattern": "...", "name": "...", "category": "..." }` in your
   `--markers` file (or in the list in `scripts/check-consent.mjs`).
3. **Mark the carrier** with `data-consent="<category>"`:

   ```html
   <script data-consent="marketing">/* the snippet */</script>
   <noscript data-consent="marketing"><img src="https://px.example.com/p.gif" alt=""></noscript>
   ```

   - A pixel's attribute goes on the `<noscript>`, not on the `<img>`: the content
     of a `<noscript>` is opaque to the Worker, which can only empty it.
   - Keep the snippet inline. In a framework that compiles scripts, mark it so the
     framework leaves it alone (Astro: `is:inline`).
   - **No `define:vars` with an attribute** (Astro drops every other attribute,
     `data-consent` included). Pass values as `data-*` and read them with
     `document.currentScript.dataset`.
   - A `type="module"` script is fine: its type is kept in `data-consent-type`.
4. **Add its domain to `vendors`** in the site's `createConsent` config, as a belt
   for a tag that arrives with a `src` and was never marked.
5. **Declare its cookies** in `cookies.<category>`: exact first-party names to
   erase on withdrawal, and `localStorage` keys by prefix (many SDKs persist
   there too). Third-party-domain cookies cannot be erased: do not list them.
6. **If the category is new to the banner**, add its text to `copy` for every
   language the site serves. A category left out of `copy.<lang>.categories` is
   not offered, and "Accept all" does not grant it.
7. **Bump `policyVersion`** if a purpose changed or a new category of third party
   was added: stored choices become "no choice" and the banner asks again.
8. **Describe it on the cookie information page**: name, purpose, provider, a
   lifetime you checked, a link to the provider's policy.
9. **Verify** (below), then deploy.

## Removing a third party

Delete the tag and its `vendors` entry, move its cookie names to `cookies.retired`
(a category that is never granted, so swept from returning visitors on every
page), and remove them once they have expired. Read what a tag manager container
loads before removing it: it may have been loading others.

## Verifying

```bash
# the build refuses a known third party without the attribute
node scripts/check-consent.mjs <output-folder>

# the served site: local (wrangler dev) or production
node scripts/check-consent-live.mjs <base-url> --paths /,/other-page --expect-blocked <N>
```

`check-consent-live` counts neutralised tags per page. **When you add a marked
third party, the expected number goes up and the script says so.** Update the
number: that is the proof the new tag is filtered. A page with nothing to block is
a failure, not a success. Then, in a real browser: no request to the third party
before a choice, it starts after "Accept", it is gone after a withdrawal (the page
reloads).

## Putting the engine on a new site

1. List what the site really loads (the hosts in the built HTML, not what you
   believe).
2. Copy `src/` and write the `createConsent` config: `site` (the key in the proof
   log), `vendors`, `cookies`, `copy` per language, `theme` (use `var(--token)` if
   the site has tokens: dark mode comes free). Leave a category out of `copy` if no
   tracker uses it.
3. Worker: `handleConsentApi` for `/api/consent*`, `pageRequest` before
   `ASSETS.fetch`, `applyConsent` after, also on the 404. `run_worker_first` is
   `["/*", "!<each asset folder>/*", ...]`: everything minus the assets, never a
   list of pages.
4. D1 binding `DB` (optional) with `migrations/0001_consent_log.sql` applied once
   and a `PROOF_SALT` secret. Test against a **local** database, never write proof
   rows to production for a test.
5. Mark the third parties, write the policy page, put `<div id="cc-preferences">`
   on it and link the footer to it.
6. Build, `check-consent`, serve locally, `check-consent-live`, deploy,
   `check-consent-live` against production.

## Limits to say out loud

- The Worker does not run JavaScript: a script that loads another dynamically is
  blocked by its first tag, not by what it loads.
- A tracker bundled in an app's JavaScript cannot be neutralised at the edge. The
  app needs a bridge: `window.__consentGranted`, the `cookie-consent` event,
  `window.cookieConsent.open()`; it starts the tracker only on a yes.
- Cookies a third party sets on its own domain cannot be erased.
- A tag injected after the Worker (Cloudflare Web Analytics: use `lite` mode) is
  invisible to both guards. Check the served HTML.
- Nothing here is legal advice.

## Checklist before delivering

- [ ] The third party carries `data-consent` on its carrier (the `<noscript>` for a pixel), inline, without `define:vars`.
- [ ] Its signature is in the build guard, its domain in `vendors`, its cookies in `cookies`.
- [ ] The cookie information page describes it, with a lifetime that was checked.
- [ ] The build passes; `check-consent-live` expects the new count and passes.
- [ ] Tested in a real browser: nothing before the choice, starts after "Accept", gone after a withdrawal.
- [ ] The engine in `src/` was not edited on this one site.
