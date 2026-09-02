## 1. Shared route and host state

- [x] 1.1 Store expansion as scoped `core.workspace--expanded=1` route state, preserve it across tool switches, restore it on reload/shared links/popstate, and verify non-workspace routes cannot inherit it.
- [x] 1.2 Expose the current Workspace Panel fullscreen presentation through the optional public host contract, update its declaration baseline, and verify legacy plugin contexts remain type-compatible.
- [x] 1.3 Retain read compatibility for older Git-namespaced expanded links while stopping new legacy writes; verify focused Git route/controller tests.

## 2. Shared interaction and tool geometry

- [x] 2.1 Move the truthful Expand panel / Exit expanded view control to the fixed Workspace Panel desktop header for all tools, remove child-tool controls, and verify labels, accessibility state, and tool-switch retention with happy-dom tests.
- [x] 2.2 Refit xterm after shared expand and exit transitions through the existing resize path, and verify focused tests observe fit/resize without recreating terminal state.
- [x] 2.3 Validate multiple bundled tools in a real desktop browser wider than 1180px: record panel bounds, tool switching while expanded, exit restoration, Git internal review layout, and Terminal identity/WebSocket/PTY geometry.
- [x] 2.4 Validate at 393x850 with a coarse pointer: record that no redundant expand control appears and existing tool controls remain reachable at the 44px floor.

## 3. Release and integration verification

- [x] 3.1 Add a patch Changeset describing the shared full-canvas Workspace Panel and verify it with `npm run changelog:status`.
- [x] 3.2 Run focused Workspace Panel, Git, Terminal, route, PiWebApp, and public API tests, `npm run typecheck`, lint changed TypeScript files, OpenSpec strict validation, and `npm run verify`; investigate every non-zero check before updating the PR.
