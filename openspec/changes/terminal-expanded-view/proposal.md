## Why

Desktop workspace tools are constrained to the ordinary right-hand panel even when their content benefits from a large canvas. Git introduced the only full-canvas requester and the Terminal branch added a second tool-local control, but duplicating controls and route ownership per tool makes behavior drift; expansion belongs to the shared Workspace Panel that contains Files, Git, Terminal, Tasks, Relays, and every other workspace tool.

## What Changes

- Add one **Expand panel** / **Exit expanded view** control to the shared Workspace Panel header for every desktop workspace tool.
- Remove tool-local expansion controls and use the existing host-owned full-canvas shell without changing tool runtime ownership.
- Preserve expanded Workspace Panel state in one machine/project/workspace-scoped URL value and restore it on reload, shared-link navigation, and browser back/forward.
- Keep expanded presentation while switching workspace tools; exiting returns the complete ordinary shell.
- Refit xterm after layout transitions so terminal columns/rows and daemon-side PTY size match the visible canvas.
- Keep mobile workspace navigation unchanged, where the selected tool already owns the available surface, and retain the 44px coarse-pointer Terminal toolbar floor found during validation.

### Non-goals

- Browser Fullscreen API, hiding browser chrome, or introducing tool-specific overlays/windows.
- Changing Terminal processes/WebSockets, Git data operations, Files behavior, or other tool domain state.
- Persisting expansion outside navigation state.
- Adding custom expansion layouts inside every tool; each tool receives the same larger Workspace Panel container and may retain its own internal responsive layout.

## Capabilities

### New Capabilities
- `workspace-expanded-view`: Reversible, shareable full-canvas viewing for every desktop Workspace Panel tool, including terminal geometry updates.

### Modified Capabilities

- None.

## Impact

- Shared Workspace Panel rendering/styles and tests.
- Application route restoration, machine navigation surface, and workspace host fullscreen contract.
- Git removes its duplicate expansion control while retaining compatibility with older Git-expanded links.
- Terminal receives shared expanded state only to refit xterm; no server/session-daemon protocol changes.
- The user-visible feature requires a patch Changeset.
