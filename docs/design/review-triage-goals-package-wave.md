# Triage: goals extraction and package publishing wave (a4824b41..be928418)

Three bllm lanes reviewed the wave: two glm lanes with split focus (goals
closure; publishing machinery) and one glm full pass. Findings below are
triaged as fixed, not-fixed-with-reason, or judged not true. Line numbers
refer to the tree as reviewed.

## Fixed

- **F1 (high, both goal lanes): the contributed goal panel's controls were
  wired to nothing.** Refresh clicked into an empty function, Pause/Resume
  rendered as usable dead buttons, archive was unreachable, and the honest
  absence lines were unreachable with it. Fixed by giving the drawer section
  contract two general seams - `requestUpdate` and an optional `runCommand`
  that goes through the session's own command surface - and wiring the plugin
  to them. A DOM-level test now clicks the real buttons.
- **F2 (high, both goal lanes): `redraw` was never assigned.** A read that
  landed after the ask left the panel on "Loading goals…" until an unrelated
  rerender. Fixed via the `requestUpdate` seam above, with a test that proves
  the host is asked when a read lands.
- **F3 (high): the package-loading test read `dist/`, which a fresh checkout
  does not have, so CI's verify-before-build order would always run it red.**
  The test now bundles the themes plugin itself from source.
- **F4/F9 (medium): core kept an orphaned goals machine** - the workspace
  slot, a ghost refresh on every idle turn feeding a slot nobody reads,
  archive/command handlers, five dead properties, the proxy routes no client
  calls, parsers for them, and stale docstrings claiming the opposite of the
  code. Removed; the code now matches what the extraction commit claims.
- **F5 (medium): a completed empty read returned `undefined` availability**,
  contradicting the contract text and rendering a permanent "No goals
  recorded" block in the navigation panel. Availability is now keyed: unread
  or in flight cannot say, a completed empty read says false.
- **F6 (medium): the plugin's read path dropped `sessionCwd` entirely**,
  including a dead ternary that was both branches `undefined`. The section
  context carries the focused session's cwd again and the read unions both
  roots, with tests.
- **F10 (low): contributed drawer tabs lacked `aria-controls`.** Added.
- **F8 (low): the plugin-api package referenced lit types without declaring
  them.** Declared as an optional peer dependency.
- **B1.2 (medium): the plugin-api subpackage's own build script pointed
  outside the repository.** Path fixed.
- **B1.3 (medium): no guard tied the release tag to the package version.**
  Both new workflows assert `tag === v${version}` (resp. `plugin-api-v${version}`)
  before packing.
- **B1.4/B3.1 (medium): prerelease would have taken over `latest`, and the
  GitHub Release was created before publish succeeded** - a failed publish
  left a release page advertising a tarball the registry does not have.
  Publish now runs first under the `alpha` dist-tag; the release is created
  only after it succeeds.
- **B1.6 (low): neither new package declared a `repository` field**, which
  provenance and trusted-publishing configuration expect. Added.

## Not fixed, with reason

- **B3.1 remainder: the "already on npm; skipping publish" rerun guard still
  exits green.** Deliberate: it is what makes rerunning a partially released
  tag idempotent, the same contract the main package's workflow documents.
  The misordered release step - the part that turned a skip into a misleading
  release page - is fixed above.
- **B2.3: the themes workflow builds twice (Build step, then npm pack's
  prepack).** No race - one job, sequential - and esbuild determinism is
  proven byte-for-byte by the freshness gate. Left as harmless redundancy.

## Owner decisions pending

- **F7 (high): the bundled themes plugin collides with the published
  `@gang-of-beads/pi-web-themes` package on any source checkout.** The
  catalog's first-writer-wins rule keeps the bundled copy and reduces the
  package copy to a duplicate-id diagnostic, and the settings panel shows a
  conflict without saying which copy is serving. Removing the bundled copy
  from the published package (or making package entries outrank bundled ones)
  is a product-semantics call.
- **Lane A 4b: `goals.read`/`goals.archive` accept any workspace path through
  the generic plugin-operation route** with no workspace vouching, while the
  dedicated proxy routes' stated invariant is that a client must never name a
  directory the host has not vouched for. Single-user local trust model
  bounds the exposure; the fix belongs to the generic operation boundary, not
  to this plugin. Owner call on where vouching lives.
- **Lane A 4.2: `sourceCheckoutPluginRoots` still points at `plugins/`, a
  directory that no longer exists** - dead dev-scope discovery. Harmless, but
  it is a lie in the code; owner call on deleting it or restoring the
  directory's purpose.

## Judged not true

- **B1.5: token-based publish from a subdirectory failing because `.npmrc`
  is written at the repository root.** setup-node exports
  `NPM_CONFIG_USERCONFIG` pointing at the runner temp copy; userconfig is
  cwd-independent. Verified against setup-node's own source.
- **B3.2: publishing the wrong tarball.** Single pack, single file, attach
  and publish consume the same file. No path found.
- **B2.4: `npm ci` in the themes repo missing build inputs.** esbuild and the
  published contract types cover it; verified against the lockfile.
