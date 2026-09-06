# Review triage: workspaces extraction wave A

Three lanes on the wave-A extraction (server file routes, nav pickers,
add-project dialog; commits b00a0707 / 620d6f2e / 4458fb45): glm max with a
server-seam focus, glm max with a client-seam focus, qwen max full pass. Every
finding below is adjudicated in writing; the pre-move parity questions were
settled with `git show`, not by trusting either lane.

## Fixed

- **Unknown workspace identity answered 500 instead of the 400 contract**
  (glm-server P1, confirmed live). `resolveRoot` awaited the injected catalog
  port outside each handler's try/catch, so a port rejection escaped to
  Fastify's default error handler. Two layers now hold the contract: the host
  port in `app.ts` maps identity misses (`WorkspaceCatalogRequestError` 404,
  the catalog's plain "Project not found"/"Workspace not found" errors) to
  `undefined` so the plugin's own not-found path answers, and every plugin
  handler awaits `resolveRoot` inside its try so anything else still answers
  400 with the real message instead of 500. The live test had already tripped
  over the deployment half of this family (see the runs pin below); the
  classifier lives in `workspaceRouteErrors.ts` where the route-error
  vocabulary belongs.
- **The add-project dialog never closed on a successful create** (all three
  lanes; the merge blocker). The moved wiring dropped the close half: a
  created project was left stranded behind the form with the button ready to
  silently re-submit. `openAddProjectDialog` now closes when `createProject`
  resolves without a failure reason, keeps it open on a reason, and still
  swallows a second open while the dialog is up. Pinned by the new
  `addProjectDialog.test.ts` (close on success, stay on failure, re-open
  after close, no stacking).
- **The bundled manifest lost its web hosting declaration**
  (glm-server P0; caught by the live probe before the lanes reported it).
  Without `runs: "web"` the workspaces package belongs to the daemon alone:
  the web process never activates its server routes and never publishes its
  browser module, so every picker, the dialog and the file endpoints vanish
  in a real install while unit tests stay green. The fix shipped with the
  probe wave; this round adds `package.test.ts` pinning `runs: "web"` and
  `type: "module"` on the shipped manifest.
- **The desktop slots fed `collapsible=true` where every sibling passes
  false** (glm-client P2, pre-move parity verified TRUE with `git show`:
  both old call sites passed `collapsible=false`, and `collapsed` therefore
  never left false). The seam's first cut threaded the panel's own
  collapsible flag into the contributed sections, giving the desktop
  projects/workspaces slots a toggle their core originals never had. The
  panel slots now pass `collapsible: false, collapsed: false` and the
  collapsed flags remain the compact panel's section-selection state only.
- **Ten dead picker properties and their wirings survived the move**
  (glm-client P2). `AppNavigationPanel` kept `projects`, `projectsLoad`,
  `onRetryProjectsLoad`, `workspaces`, `deletingWorkspaceIds`,
  `workspaceLabelItems`, `onSelectProject`, `onCloseProject`,
  `onSelectWorkspace` and `onDeleteWorkspace`, all fed by `PiWebApp`, all
  unread by the slotted sections. Deleted on both sides.
- **The plugin re-copied the shell's list and surface styles**
  (glm-client P2, qwen adjacent). `sharedStyles.ts` duplicated
  `ui.listStyles`/`ui.surfaceStyles` verbatim - the file's own header
  admitted the next shell-side retune would not reach the pickers. The
  copies are gone; the elements adopt the host styles per instance in
  `createRenderRoot`, because `static styles` freezes at module load, which
  runs before the host is remembered. No host (raw element mounts in tests)
  means no styles, not a stale copy. The same statics-time freeze is a
  latent flaw in the files plugin's `filesSurfaceStyles()` usage; left for
  its own wave, recorded here so it is not rediscovered.
- **WorkspaceList honored the seam's `hidden` display without the retire
  half of the contract** (glm-client P2; pre-move parity verified TRUE in
  the other direction: the core WorkspaceList never had the retire block,
  it is the sibling the ProjectList fix never reached). A query left in the
  search field survived a hidden section switch and silently narrowed rows
  on return. WorkspaceList now retires the query when hidden, matching
  ProjectList.
- **The plugins build type-checked test files it does not ship** (found
  while landing the dialog test: the test's context-stub import reaches
  `appUrl.ts`, whose `import.meta.env` is untyped outside the Vite env
  declarations the plugins tsconfig never loads). `tsconfig.plugins.json`
  now scopes to the shipped sources - tests type-check in the root project
  which already spans both worlds.

## Judged not true / not fixed

- **"Suggested a runs pin test"** (glm-server P0 rider): adopted as a
  manifest pin (above) rather than a catalog-snapshot pin - the snapshot
  path was already covered by "carries the runs declaration through
  discovery"; the defect lived in the shipped package.json, so that is what
  the pin guards.
- **"A disposed/reap hook is needed on the dialog seam"** (qwen note): true
  by construction but unreachable today - every host close path fires
  `onClose`, and `disposePlugin` is never called at runtime. Recorded as a
  seam note, not built.
- **"Every add-project affordance is gated on async plugin load"** (glm-client
  P2, report-only): accepted product semantics of the plugin seam - a failed
  load is honest absence, and the bundled plugin's load is one module import.

## Clean (verified by the lanes, one line each)

- Focus machine / shared refs self-heal across the panel/sheet ping-pong;
  shortcut suppression while the sheet is open holds.
- Context snapshots are rebuilt every render; labelItems by-id misses return
  empty; trust reads re-read on every menu open.
- Dialog keydown scoping, Escape/backdrop ownership and focus order are the
  surface's; the suggestion/trust staleness counters are pinned by tests.
- `errors.ts` matching HttpError by name is deliberate (cross-copy
  `instanceof` would break); `CORE_STATUS_FLAGS` re-declares wire ids with
  matching values.
- No production code imports the deleted core picker/dialog files; the
  plugin imports only `lit` and the plugin API.
