# Changesets

Add one changeset per user-visible change with `pnpm run changeset`, or write a file here by hand:

```md
---
"@gang-of-beads/pi-web": patch
---

Say what changed for the user, in one or two sentences.
```

Always use `patch`. Never use `minor`: the version is `MAJOR.YYYYMM.PATCH`, and the month is set from the release date when a release is cut. `major` is reserved for a breaking release the maintainers have agreed on.

Release notes describe the impact on users. Do not name a maintainer, a private host or an internal test stack.

See [CONTRIBUTING.md](../CONTRIBUTING.md#changesets) for when a change needs one, and [docs/releasing.md](../docs/releasing.md) for how changesets become a release.
