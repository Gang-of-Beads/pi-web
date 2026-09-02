## Why

The terminal workspace panel is constrained to the ordinary right-hand panel on desktop even when the user needs a large terminal canvas. The shell already has one full-canvas producer—the workspace host fullscreen state introduced for Git—but only the Git plugin can request and exit it; the core terminal renderer has no fullscreen control or route state, so terminal users cannot enter the same reversible, shareable surface.

## What Changes

- Add an explicit **Expand terminal** / **Exit expanded terminal** control to the core terminal panel on desktop.
- Reuse the workspace host fullscreen boundary so expansion hides the navigation/chat panes and gives the terminal workspace panel the full application canvas without changing terminal runtime ownership.
- Preserve the selected terminal and expanded terminal state in the existing machine/project/workspace-scoped URL, and restore it on reload, shared-link navigation, and browser back/forward.
- Exit the shell fullscreen presentation when the terminal panel is no longer active, while retaining only route state that belongs to a matching terminal route.
- Refit xterm after each layout transition so terminal columns/rows and the daemon-side PTY size match the visible canvas.

### Non-goals

- Browser Fullscreen API, hiding browser chrome, or introducing a second terminal window.
- Changing terminal creation, persistence, command-run ownership, WebSocket transport, shell processes, copy mode, or soft-key semantics.
- Adding an expansion control to mobile layouts, where the selected workspace tool already owns the available main surface.
- Generalizing every workspace tool in this change; the host boundary remains reusable, but this change integrates only the core terminal surface.

## Capabilities

### New Capabilities
- `terminal-expanded-view`: Reversible, route-restored full-canvas terminal viewing and xterm resize behavior.

### Modified Capabilities

- None.

## Impact

- Core terminal panel rendering and tests under `src/client/src/components/TerminalPanel.ts`.
- Core workspace-panel wiring under `src/client/src/plugins/core/panels.ts`.
- Application route restoration and workspace host fullscreen ownership in `src/client/src/components/PiWebApp.ts` and route-focused tests.
- No server/session-daemon protocol, persistent data, dependency, or terminal process lifecycle changes.
- The feature is user-visible and requires a patch Changeset.
