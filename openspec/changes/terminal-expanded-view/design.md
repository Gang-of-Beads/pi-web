## Context

See proposal.md for motivation and `specs/terminal-expanded-view/spec.md` for the behavior contract. The desktop shell already owns a `workspacePanelFullscreen` layout state and exposes an optional workspace-host setter used by Git. The core Terminal panel is rendered through the same `WorkspacePanelContext`, while its selected terminal is already bidirectionally bound to `core.workspace.terminal--terminal`. Xterm owns a live WebSocket and uses `ResizeObserver`/`FitAddon` to keep PTY dimensions aligned with its container.

The only shell-layout producer is `PiWebApp.workspacePanelFullscreen`; Git and the proposed Terminal control are requesters of that one state. The only Terminal surface producer is the core workspace panel contribution. There is no second standalone terminal renderer: runtime actions eventually select this same workspace tool and terminal route.

## Goals / Non-Goals

**Goals:**
- Give the active desktop Terminal panel a reversible full-canvas presentation without reconnecting its terminal.
- Make expanded state part of the matching Terminal URL and browser-history contract.
- Keep shell ownership in the app, terminal UI/fit behavior in `TerminalPanel`, and route serialization in the existing workspace route surface.
- Refit and report PTY dimensions after either layout transition.

**Non-Goals:**
- Move terminal runtime or WebSocket ownership, add browser fullscreen, or create a terminal-specific overlay/portal.
- Persist expanded state outside navigation state or apply it to non-Terminal tools.
- Change mobile tool navigation, soft keys, copy mode, or terminal tabs.

## Decisions

### 1. Reuse the host-owned full-canvas shell instead of adding a terminal overlay
The Terminal panel will request the existing workspace-panel fullscreen layout through `WorkspaceHost`. The host contract will expose the current presentation state as well as its setter, allowing the terminal control to render the truthful Expand/Exit label and `aria-pressed` state.

A dialog, fixed-position terminal, or portal was rejected because moving/recreating xterm risks duplicate WebSockets, lost selection/copy state, focus churn, and competing layout ownership. The existing shell mode already preserves the workspace panel element in place.

### 2. The app owns Terminal expanded route serialization
The existing workspace route surface will gain a boolean Terminal-expanded field represented as `core.workspace.terminal--expanded=1`. `PiWebApp` will read it during route restoration and apply it only when the resolved tool/view is the core Terminal for the matching machine/project/workspace. Its workspace-host setter will synchronize this field only while Terminal is the active surface; Git continues to own its own plugin-namespaced expanded route.

Keeping route writes in the app avoids teaching a core component to mutate `window.history` and keeps machine navigation, popstate restoration, and selection scope in one orchestrator. A generic unnamed `expanded=1` key was rejected because it could leak across workspace tools.

### 3. TerminalPanel owns the visible control and transition fit request
`TerminalPanel` will receive the host presentation state and callback through core panel wiring. Its terminal tab toolbar will show a desktop-only Expand terminal / Exit expanded terminal toggle. After requesting a transition it will schedule a fit after the parent Lit update and animation frame; the existing `ResizeObserver` remains the backstop for subsequent geometry changes.

The control is hidden in coarse/narrow mobile layouts where the workspace tool already fills the available content region. The selected terminal and xterm instance remain mounted, so expansion does not become a terminal lifecycle event.

### 4. Disconnect exits presentation but does not manufacture a stale route
When TerminalPanel disconnects, it requests shell exit. During route restoration, host route synchronization is suppressed until the new route has established its selected surface, preventing an old panel's teardown from rewriting the destination URL. Returning through browser history reapplies the route's Terminal-expanded state.

This preserves the invariant that every expanded state has an exit even when the user leaves via a different workspace tab, machine, project, or browser-history action.

## Risks / Trade-offs

- [Git and Terminal request the same shell state during a panel switch] → Keep one host owner, exit on disconnect, and reapply the resolved active route after restoration; add switch-order regression coverage.
- [A fit runs before the parent grid settles] → wait for component update plus animation frame and retain the existing container `ResizeObserver` as a second signal.
- [Fullscreen state leaks to Files or another plugin] → gate restoration and URL writes by the resolved active Terminal tool and clear shell presentation on disconnect/nonmatching routes.
- [Mobile toolbar becomes crowded] → do not render/show the redundant expansion control in the established mobile/coarse layout.
- [Public host contract grows] → add only an optional read method alongside the existing optional setter so older browser plugins remain compatible.

## Migration Plan

1. Ship the client-only route, host, and Terminal changes in one package with a patch Changeset.
2. No daemon restart, terminal process migration, or durable data migration is required.
3. Rollback restores the previous client; unknown namespaced query fields are already preserved/ignored safely, and a reload returns to the ordinary terminal panel.
