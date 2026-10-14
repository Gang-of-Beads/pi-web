# Releasing PI WEB

This page is for maintainers. Releases are published only by GitHub Actions, from a pushed tag; nobody publishes to npm from a local machine.

## Version scheme

PI WEB uses calendar versions shaped as semver: `MAJOR.YYYYMM.PATCH`, for example `2.202610.5`.

- `YYYYMM` is the year and month of the release date.
- `PATCH` is `0` for the first release of a major version in a month, and goes up by one for each later release that month. If npm already has the computed version, keep increasing `PATCH` until it is free.
- `MAJOR` changes only for a breaking release the maintainers have agreed on.

Because the month sits in semver's `minor` slot, every non-breaking changeset is `patch`; Changesets' own bump is overridden with the computed version below.

## Prepare the release

On an up-to-date `main` with a clean working tree:

1. Review the pending changesets: `pnpm run changelog:status`, then read `.changeset/*.md`. Each should describe the user impact. Change any non-breaking `minor` to `patch`.
2. Consume them: `pnpm run release:version`. This writes the new `CHANGELOG.md` section and bumps `package.json`.
3. Set the computed version: `pnpm pkg set version=<MAJOR.YYYYMM.PATCH>`, and make the new `CHANGELOG.md` heading match it.
4. Resync the lockfile, then confirm it: `pnpm install --lockfile-only`, then `pnpm install --frozen-lockfile`.
5. Run the gates: `pnpm run verify`, `pnpm run build`, `pnpm run pack:dry`.
6. Commit `package.json`, `pnpm-lock.yaml`, `CHANGELOG.md` and the consumed `.changeset` files as `chore(release): v<version>`, and push it to `main`.

## Tag and publish

```bash
git tag v<version>
git push origin v<version>
```

The tag starts `.github/workflows/publish.yml`, which runs, in order:

- `pnpm run verify`, `pnpm run build` and `pnpm run pack:dry` on Windows;
- Nix builds of the package for aarch64-linux and aarch64-darwin, pushed to the `gang-of-beads` Cachix cache;
- on Linux: `pnpm run verify`, `pnpm run build`, the npm global install smoke test (`pnpm run smoke:package-install`, which also compares the plugin API declarations with their committed baseline), and the Nix package build;
- `pnpm pack`, a GitHub Release for the tag with that tarball attached and generated notes, and `pnpm publish` of the same tarball to npm.

npm publishing uses trusted publishing (OIDC) with provenance. While the `NPM_TOKEN` secret exists, the workflow publishes with that token instead and without provenance; that route exists only to bootstrap a new package, and the secret should be removed once trusted publishing is configured.

The curated notes are the `CHANGELOG.md` section. To use them on the GitHub Release, run `gh release edit v<version> --notes-file <file>`; editing notes does not publish again.

## Re-running a release

If a run fails for a transient reason, re-run its failed jobs. To re-run the whole release for an existing tag, dispatch the workflow on it: `gh workflow run publish.yml --ref v<version>`. A re-run is safe: the publish step skips a version npm already has, and the release step updates the existing GitHub Release. A version that reached npm cannot be replaced; fix forward with a new version.

## The plugin API package

`@gang-of-beads/pi-web-plugin-api` (`packages/pi-web-plugin-api/`) carries the type declarations of the plugin contract. It is released separately:

1. Set the new version in `packages/pi-web-plugin-api/package.json` and commit it to `main`.
2. Push a tag named `plugin-api-v<version>`, matching that version exactly.

`.github/workflows/publish-plugin-api.yml` verifies, builds the declarations, checks that the tag matches the package version, publishes under the `alpha` dist-tag, and then attaches the tarball to a GitHub Release.

The declarations a plugin compiles against are pinned by `test-fixtures/plugin-api-baseline/`. A change to the public plugin API must refresh that baseline in the same commit (`node scripts/refresh-plugin-api-baseline.mjs`); otherwise `pnpm run verify` and the release smoke test fails.

## Plugins in their own repositories

The plugins and pi packages the project maintains outside this repository (listed in [docs/plugins.md](plugins.md#packages)) are released from their own repositories, by their own tags; each repository's README says how.
