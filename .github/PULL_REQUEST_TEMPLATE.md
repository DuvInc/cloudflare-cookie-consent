## What this changes

<!-- One or two sentences. If it fixes an issue, write "Fixes #123". -->

## Why

<!-- What leaked, broke, or could not be expressed before. -->

## Checklist

- [ ] `npm test` passes locally
- [ ] Commits are signed off (`git commit -s`); see CONTRIBUTING.md
- [ ] If the rewrite, the headers or the runtime changed: the new behaviour has a test, and I ran `npm run example` then `npm run check:example` against the real HTMLRewriter
- [ ] If a tag is now blocked or released differently: the count `check-consent-live` expects was updated in the example
- [ ] `src/` still reads no environment variable at import and makes no network call
- [ ] The runtime string still has no backslash, backtick or `${` (a test checks)
- [ ] No new dependency, or it was discussed in an issue first
- [ ] No real token, site key or consent log row in this diff
