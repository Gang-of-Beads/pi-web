# Triage: machines/workspaces extraction design review

Three bllm lanes reviewed the design (closure; seam feasibility; full-pass
red team), each spot-checking claims against the live tree. Findings triaged
below. The headline: **the design's shape survives, but its premise does
not** — the current plugin contract cannot host either server-side feature,
and the workspaces moved-set as drawn breaks the build in four places.

## The premise gap all three lanes hit

`ServerPluginActivationContext` is a closed eight-field set; server plugins
activate only in sessiond; there is no route-contribution seam, no
host-port injection, no dialog seam on the browser side, and
`ServerPluginOperation` answers JSON only (8 MiB cap, 10s deadline) — it
cannot express the Range-streaming file preview or the federated route
family. "Routes glue moves with the plugin" has no contract behind it.

That reduces to an owner decision (below), not a detail to improvise.

## Fixed in the amended design (no owner input needed)

- **Preview policy/headers promoted to shared.** `filePreviewResponsePolicy`
  and `filePreviewResponseHeaders` are consumed by the machines proxy
  (`machineProxyRoutes.ts:7-8`) and named by `federatedRoutes.ts:22`
  (`MAX_INLINE_PREVIEW_BYTES`) — they are protocol, not plugin. Same for
  `workspaceRouteErrors` (consumed by core `app.ts` and terminal proxy) and
  `workspaceContext` (consumed by terminal proxy and trust routes; its
  security property is "server-resolved, never verbatim").
- **`projectPiWebConfig` split**: the reader serving the core
  `GET /projects/:id/workspaces` response shape stays core (AGENTS.md makes
  `<project>/.pi-web/config.json` a core-owned file); a plugin consumes it.
- **`workspaceSessionsCache` stays core**: `sessionController` consumes it
  and session lists are core.
- **`runtimeProvider` wiring stays core-assembled**: losing it would flag
  every server plugin "restart required" falsely.
- **`sessionDaemonWorkspaceCatalog` stays core** (it is the web-side client
  over the daemon protocol), resolving the self-contradictory sentence.
- **Registry honesty**: the registry is not "opaque" to machines — it
  encodes local/remote semantics (`registry.ts:522`, hardcoded `"local"` at
  `:633`). The design now says: import `LOCAL_MACHINE_ID`, converge the
  gateway/remote visibility decisions into one classifier.
- **`.pi-web/config.json` declared core-owned**; plugins consume.
- **Precision**: line counts corrected (machines ~1.9k, workspaces ~3.7k
  incl. tests); the fleet port is `FleetMachines` (needs `localMachine`/
  `remoteClient`), not `MachineRouteService`; QuickSwitcher machine tabs stay
  core with the tuple; "no worktree-specific core code" retracted
  (`worktreePreRemoveHook.ts` exists and stays in the daemon); machine
  status AppState fields, `machine.status` event handling, and
  `shouldDeferRemoteRouteRestore` declared core protocol gating.

## Owner decisions (asked, pending)

1. **Extraction shape.** (A) Contract-first: add a web-process plugin
   runtime, route contributions with streaming responses, host-port
   injection, and a dialog seam — then extract fully. (B) UI plugin, service
   core: browser plugins own the management UI through new seams; the server
   file/machine services stay core behind injected ports. (C) Do not
   extract; record the asymmetry as the reason.
2. **No-plugin baseline.** What does the shell honestly show when
   pi-web-workspaces or pi-web-machines is not installed — and is installing
   them always mandatory (shipped by default)?

## Judged not true / withdrawn

- "Workspaces can move first because the UI is already section-shaped" —
  withdrawn (F16/F5: the Files main view and `FileExplorerController` are
  core-shell first citizens, not sections).
- "Sequencing workspaces-then-machines" — the ordering argument collapsed;
  both waves depend on the contract decision above, and neither is
  independently deployable across federated machines unless the file-route
  family stays core-served (an owner question inside decision 1).
