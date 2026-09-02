## 1. Route and host state

- [x] 1.1 Extend the workspace route surface with a scoped `core.workspace.terminal--expanded=1` value and verify read/write, refresh, shared-link, popstate, and non-Terminal route behavior with focused route and PiWebApp tests.
- [x] 1.2 Expose the current workspace-panel fullscreen presentation through the optional public host contract, update its declaration baseline, and verify legacy plugin contexts remain type-compatible with `npm run typecheck` and the plugin API baseline test.

## 2. Terminal interaction and geometry

- [ ] 2.1 Wire the core Terminal contribution to the host fullscreen state and add a truthful Expand terminal / Exit expanded terminal control that exits on disconnect; verify state, labels, accessibility attributes, terminal identity retention, and tool-switch cleanup with happy-dom component tests.
- [ ] 2.2 Refit xterm after expand and exit transitions through the existing resize path, and verify focused tests observe the fit/resize notification without recreating the terminal or WebSocket.
- [ ] 2.3 Validate desktop behavior in a real browser at a viewport wider than 1180px: record the terminal bounds before/after expansion, confirm the application canvas is occupied, confirm exit/tool switching restores the shell, and inspect that the selected terminal and WebSocket remain stable.
- [ ] 2.4 Validate at 393x850 with a coarse pointer: record that no redundant expand control appears, terminal tabs/soft keys remain reachable, and the existing mobile workspace layout is unchanged.

## 3. Release and integration verification

- [ ] 3.1 Add a patch Changeset describing the full-canvas desktop terminal and verify it with `npm run changelog:status`.
- [ ] 3.2 Run focused Terminal, route, PiWebApp, and plugin API tests, `npm run typecheck`, lint changed TypeScript files, and `npm run verify`; record exact results and investigate every non-zero check before opening the implementation PR.
