## What and why

<!-- What this changes and why. Link the issue: "Fixes #123". -->

## Changeset

- [ ] Added a `patch` changeset (`pnpm run changeset`)
- [ ] Not user-visible, no changeset needed

## Verification

- [ ] `pnpm run verify` passes locally

Browser checks (a real browser against a running session daemon):

- Desktop: <!-- the flows you tried -->
- Phone, 393x850 with a coarse (touch) pointer: <!-- the flows you tried, or "not a phone surface" -->

## Session daemon restart

- [ ] Needed after deploying this change (it touches `src/server/sessiond.ts`, `src/server/daemon/`, `src/server/shared/`, a server plugin, or the daemon protocol)
- [ ] Not needed
