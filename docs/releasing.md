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
- `pnpm pack`, a GitHub Release for the tag with that tarball attached, whose body is the install block followed by GitHub's generated notes, and `pnpm publish` of the same tarball to npm.

npm publishing uses trusted publishing (OIDC) with provenance. While the `NPM_TOKEN` secret exists, the workflow publishes with that token instead and without provenance; that route exists only to bootstrap a new package, and the secret should be removed once trusted publishing is configured.

Every release then gets written notes, drawn from its `CHANGELOG.md` section: replace the release body with `gh release edit v<version> --notes-file <file>`. Editing notes does not publish again. The release skill (`.agents/skills/npm-release-via-github-actions/SKILL.md`, step 10) describes what the notes contain.

## Re-running a release

If a run fails for a transient reason, re-run its failed jobs. To re-run the whole release for an existing tag, dispatch the workflow on it: `gh workflow run publish.yml --ref v<version>`. A re-run is safe: the publish step skips a version npm already has, and the release step updates the existing GitHub Release. That update writes the install block and generated notes over the release body, so re-apply the written notes with `gh release edit` after any re-run or dispatch. A version that reached npm cannot be replaced; fix forward with a new version.

## Upgrading the pi SDK

When the `@earendil-works/pi-coding-agent` version changes, check the SDK behavior PI WEB depends on beyond the SDK's typed API:

- `/new` stops the session at the moment pi is certain to switch, from the `session_before_switch` handler of PI WEB's own inline extension (`src/server/daemon/sessions/newSessionSeam.ts`). That moment is right only while pi loads inline extensions after the extensions it finds on disk, calls `session_before_switch` handlers in load order and returns at the first cancel, and aborts the run only after that event (`AgentSessionRuntime.newSession`). If the extension is no longer last, `/new` answers "/new is not available for this session runtime." instead of switching.
- PI WEB keeps its own table of pi's built-in slash commands (`src/shared/builtinSlashCommands.ts`), because pi does not export its list. Compare it with `BUILTIN_SLASH_COMMANDS` in the SDK's `dist/core/slash-commands.js`: a command pi added needs a row (page, daemon or unavailable), and a changed description or argument hint is copied over.

## The plugin API package

`@gang-of-beads/pi-web-plugin-api` (`packages/pi-web-plugin-api/`) carries the plugin contract's declarations and public runtime helpers, without the host application or its native dependencies. Its alpha releases are separate from PI WEB releases:

1. Set the new version in `packages/pi-web-plugin-api/package.json`, update the package README's host compatibility line, verify the changes and commit them to `main`.
2. Push a tag named `plugin-api-v<version>`, matching that version exactly. Do not use a core `v*` tag.

`.github/workflows/publish-plugin-api.yml` verifies, builds and packs the API package, then installs that tarball into an isolated consumer outside the checkout. It compiles browser and server consumers separately and checks runtime imports without the host or `node-pty`. Every version, alphas included, is published under npm's `latest` dist-tag, so `npm install @gang-of-beads/pi-web-plugin-api` installs the newest one and no dist-tag has to be moved afterwards.

For the first publication, configure a temporary, stage-only token as the GitHub Actions secret `NPM_PLUGIN_API_STAGE_TOKEN`, not the core workflow's `NPM_TOKEN`. CI stages the tarball; a maintainer approves it on npmjs.com with 2FA. CI waits up to 30 minutes for public registry visibility, checks that the registry's tarball matches its artifact and only then creates a GitHub prerelease. A pending stage is not a completed publication.

If the wait times out, approve the stage first and rerun the failed job. An already-staged version is not staged again, and an already-published version is not republished. After the first publication, configure npm trusted publishing for `Gang-of-Beads/pi-web`, workflow `publish-plugin-api.yml`, with permission to run `npm publish` (`--allow-publish` when using the npm trust CLI), then delete the temporary secret and revoke its token. A stage-only trusted publisher cannot run this workflow's no-secret route. Subsequent publications use OIDC with provenance when the secret is absent.

A manual workflow dispatch on a branch runs the checks and smoke test without publishing. A dispatch on the matching plugin-api tag may publish.

The declarations a plugin compiles against are pinned by `test-fixtures/plugin-api-baseline/`. A change to the public plugin API must refresh that baseline in the same commit (`node scripts/refresh-plugin-api-baseline.mjs`); otherwise `pnpm run verify` and the release smoke test fails.

## Plugins in their own repositories

The plugins and pi packages the project maintains outside this repository (listed in [docs/plugins.md](plugins.md#packages)) are released from their own repositories, by their own tags; each repository's README says how.
