# Triage: Wave 0 web-plugin-runtime design review

Three bllm lanes (server seam feasibility; browser seams and state
ownership; full-pass red team), each spot-checked against the live tree.
Headline: the five seams are the right seams, but the pilot as written was
not implementable, the dual-runtime lifecycle story was one sentence where
it needed a mechanism, and three browser claims contradicted the tree.

## Fixed in the amended design

- **Pilot slice made concrete** (the biggest gap): the preview route moves
  together with its semantic body — `filePreviewService`,
  `pathAccessPolicy`, and the file classification constants move into the
  workspaces skeleton as plugin code; the response policy/headers reach the
  plugin through re-exports in `server-plugin-api.ts` (the contract package
  already carries shared types via `tsconfig.plugin-api.json`); the
  `WorkspaceCatalogPort` is shaped for plugin needs and returns
  `{ projectPath, workspacePath }` — it is a contract type, not the core
  `WorkspaceCatalog` verbatim, so no core-internal imports and no 300-line
  safety-critical copies.
- **Route handle signal semantics**: handles are not bounded by the 10s
  lifecycle timeout; the handle signal is request cancellation; routes whose
  path is in the federated table inherit that entry's transport bounds
  (`responseBodyLimit`, `propagateCancellation`).
- **Dual-runtime lifecycle mechanism**: catalog parity first (the web
  catalog gains `projectPlugins` and the same agentDir/config semantics as
  sessiond); runtime snapshots are keyed by process role
  (`{ daemon, web }`), `restartRequired` is computed per process,
  `cachedArtifactIsActive` reads the web snapshot for web-activated plugins,
  and the snapshot shape gains per-process records instead of one flat
  array.
- **Content-type parsers stay host plumbing**: pre-registered at app level;
  a route contribution cannot carry them (plugins cannot import fastify).
- **Dialog seam detailed**: a plugin dialog joins all three host registries
  (`modalLayerRegistry`, the `modalLayerOpen` list, `pushModalLayerFrame`
  for Android back), with a defined close-reason enum; the `machine.add`
  action chain migrates with MachineDialog rather than bouncing
  core → host → plugin → host.
- **State ownership, one principle** (aligned with the terminal precedent,
  superseding "removed rather than mirrored"): selection pointers mirror
  into core AppState because URL surfaces, machine navigation memory,
  workspace-scoped reset, and refresh dispatch are shell concerns; file
  content/tree state is plugin-owned. Core actions and refresh dispatch
  resolve panel ids through `resolveWorkspacePanelRouteId` instead of
  hardcoding `core:workspace.files`.
- **Machines state**: `state.machines`/`selectedMachine` are tuple state and
  stay core AppState; the moving controller writes them through host
  setters; QuickSwitcher keeps reading the single source. With the plugin
  absent the machines list is empty and the URL machine param fails
  honestly.
- **Honest absence mechanics**: the deleted `pluginSurfaceVisibility`
  abstraction is not referenced; the workspace panel selector must not fall
  back to the first visible panel when the requested tool is missing
  (explicit missing state), and core actions gate on registry availability
  (the `disabledReason` precedent from updates).
- **Route conflict and absence answers**: a duplicate method+path
  contribution is refused with a diagnostic (plugin → failed, not a startup
  crash); absent routes answer 404 under `/api` and 501 under the machine
  prefix (the proxy's existing honest "not registered" answer) — both
  stated, not flattened to "404".
- **Version skew**: unknown activation keys produce a warning diagnostic
  (precedent: the plural-workspaceProvider refusal), never silent drop.
- **Storage scoping**: `runs:"both"` plugins get per-process storage roots
  (`plugin-storage/<id>.web` vs daemon default) — no cross-process
  read-modify-write.
- **Transitional dual-mount**: moving a route into the skeleton and removing
  the core route land in one commit; Fastify would refuse the duplicate.
- **Contract release as a step**: routes/ports are a published-contract
  change (baseline update + `plugin-api-v*` tag workflow); `runs` itself is
  manifest metadata and needs no contract release.
- **Precision**: the operations channel cap is 256 KiB (8 MiB is the
  plugin-backend response cap); anchor line numbers corrected; the
  self-contradictory "— wait, no" pilot sentence removed; supersession notes
  added to `plugin-architecture.md` (entry-point model, route namespace).

## Pilot redefined (was "proves every seam in one vertical")

- Proof 1 (workspaces skeleton): preview route + `WorkspaceCatalogPort` +
  `PiWebConfigPort`, health reporting missing ports (honest degrade). This
  exercises streaming routes, ports, and web-process hosting for real.
- Proof 2 (updates plugin): a minimal NEW dialog (nothing dialog-shaped
  exists there today — the design's claim was false) proving the dialog
  seam without dragging MachineDialog's complexity in.
- Not proven by the pilot, explicitly: `ownsController` panels (shape only;
  proven in Wave A where the risk actually lives) and the `fleetMachines`
  port's plugin-side consumption (type-move in Wave 0; proven in Wave B).
- Acceptance includes the resilience change: with the skeleton deactivated,
  preview answers 404 and the probe asserts it (core-served forever is no
  longer true for this route).

## Judged not true / withdrawn

- "The machines proxy keeps forwarding by the table" — withdrawn as
  written: the proxy's preview leg is bespoke (Range not forwarded,
  Content-Range/Accept-Ranges stripped by the header whitelist, inline
  bodies buffered to the table limit). Pre-existing federated-leg defect,
  filed to CHECKLIST as its own item; the design no longer implies
  transparency, and the "same plugin set" constraint is restated as "each
  end is servable by its own core/plugin generation".
- "The updates plugin already owns a dialog-shaped surface" — false.
- "The web runtime's records feed the reader" as a mechanism — replaced by
  the per-process snapshot rules above.
