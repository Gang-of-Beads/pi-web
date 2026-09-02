## Context

See proposal.md and `specs/workspace-expanded-view/spec.md`. `PiWebApp` owns the only full-canvas shell state and exposes optional host read/write methods. `WorkspacePanel` owns the stable tool-tab header and renders every workspace contribution. Git currently has a duplicate internal control and legacy namespaced route field; Terminal briefly gained another local control while still relying on the same host state.

The shell has one layout producer (`PiWebApp.workspacePanelFullscreen`) and one shared Workspace Panel renderer. Therefore expansion is a property of that panel, not of whichever child tool happens to request it.

## Goals / Non-Goals

**Goals:**
- Put one truthful, reversible expansion control in a stable shared header for all desktop workspace tools.
- Use one workspace-scoped route value while preserving older Git links.
- Keep expansion active during tool switches so the shared header remains the owner and exit path.
- Preserve tool instances/state and refit Terminal geometry in place.

**Non-Goals:**
- Tool-specific overlays, browser fullscreen, or custom full-canvas semantics per tool.
- Changes to Git backend, terminal runtime/WebSocket ownership, or other tool domain behavior.
- A visible expansion control on mobile, where the shared header is intentionally absent.

## Decisions

### 1. WorkspacePanel renders the single expansion control
The shared desktop header renders Expand panel / Exit expanded view using the host read/write contract. All contributions receive the capability automatically; no opt-in flag or duplicated child control exists. The action stays outside the horizontally scrolling tab strip so it remains reachable with many tools.

Opt-in was rejected after product review because it recreates inconsistent tool capabilities and requires every plugin to implement the same shell behavior. Tool-local controls were rejected because Git and Terminal had already drifted in label, placement, lifecycle, and route ownership.

### 2. Expansion uses one workspace-scoped route field
The route surface stores `core.workspace--expanded=1`, scoped by the existing machine/project/workspace/tool route. It is remembered with machine navigation and applied only after the matching workspace tool resolves. Switching tool tabs retains expansion because the owning Workspace Panel remains mounted; leaving workspace-panel views clears it.

Git's previous `*.git.workspace.git--expanded=1` remains read-compatible. Git stops producing that field; when the legacy route activates the host, the app writes shared state and removes the old field. A separate expanded field per tool was rejected because expansion now belongs to the common panel and would create contradictory values.

### 3. Child tools observe host geometry but do not own shell controls
Git derives its expanded internal split from the host's current state, preserving its multi-file review layout without an internal button. Terminal receives the same state to schedule `FitAddon` after parent update plus animation frame; its existing ResizeObserver remains the geometry backstop. Other tools simply receive a larger container.

### 4. Mobile continues using its existing workspace-tool layout
The Workspace Panel header is already hidden at widths up to 1180px, so no redundant action enters mobile navigation. Real-browser validation found Terminal toolbar targets at 30px; the coarse/narrow rule raises them to the project's 44px touch floor without changing terminal semantics.

## Risks / Trade-offs

- [A plugin assumes a narrow panel] → expansion changes only its container; validate bundled tools and retain their own responsive CSS/overflow boundaries.
- [Git legacy route conflicts with shared state] → read legacy only for compatibility, stop writing it, and make the app's shared route authoritative.
- [Terminal fit runs before the grid settles] → wait for update plus animation frame and retain ResizeObserver.
- [Many workspace tabs crowd the header] → keep the expansion action fixed outside the independently scrollable tab strip.
- [Public host contract grows] → retain optional methods so older browser plugins remain compatible.

## Migration Plan

1. Ship shared header, route, Git compatibility, and Terminal fit changes together with a patch Changeset.
2. No daemon restart or durable data migration is required.
3. Older Git expanded URLs remain accepted; new links use `core.workspace--expanded=1`.
4. Rollback ignores the shared unknown query field and returns to ordinary layout on reload.
