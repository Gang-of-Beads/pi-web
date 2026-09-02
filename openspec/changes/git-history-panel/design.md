## Context

See proposal.md for motivation and `specs/git-history-panel/spec.md` for the behavior contract. The Git contribution is a paired browser/server plugin: browser state is held per machine/project/workspace in `GitUiController`; the server plugin runs only Git subprocesses through the provider request boundary. Status currently lists only porcelain working-tree/index changes and diff retrieves staged or unstaged file patches.

History adds two read operations with potentially larger output, pagination, and commit identity. It must remain inside the Git plugin boundary: neither the generic workspace provider protocol nor session daemon ownership needs new behavior.

## Goals / Non-Goals

**Goals:**
- Keep history data, selection, pagination, and errors keyed by `machine.id + projectId + workspace.id`.
- Use an immutable commit snapshot for a Load more sequence, so commits do not move or duplicate while a user reads.
- Bound every Git subprocess and HTTP/plugin response using existing command and response limits.
- Reuse the existing diff viewer's unified-diff renderer where its input is valid.

**Non-Goals:**
- Add a generic version-control API, persistent history cache, Git graph renderer, or mutations.
- Poll and silently prepend commits while the user is reading; a refresh is explicit so rows do not move under a pointer.

## Decisions

### 1. History is a main content mode; List/Tree remain Changes presentation
Introduce a `GitPanelMode` state (`changes | history`) per workspace. Render a stable top-level Changes/History control in the Git toolbar. Render List/Tree and change-specific expand/collapse controls only in Changes.

This matches the data model: List and Tree are alternate arrangements of one status result; History has its own result, selected object, pagination, and error lifecycle. A three-way List/Tree/History toggle would incorrectly imply equivalent modes and make the history-specific state harder to explain. A separate panel would allow side-by-side work but adds navigation surface and does not improve the initial read-only workflow.

### 2. Add narrow provider operations and shared validated contracts
Add `history` and `commit-diff` alongside `status` and `diff`. The browser contract defines only JSON-safe commit summaries, a paginated history response, and a selected commit diff response; the browser remains ignorant of Git invocation details. Input is a validated page cursor/snapshot token or a full object ID originating from a loaded history item.

The Git server plugin remains the only component that invokes Git. This retains execution policy, environment scrubbing, timeout, output truncation, owner/revision validation, local/remote-machine routing, and error attribution at existing boundaries. Extending a generic workspace API would make a Git-specific feature part of every provider's contract.

### 3. Snapshot initial history at HEAD; paginate by an opaque cursor
The first history response resolves the worktree's `HEAD` commit and returns a bounded page (50 entries) plus an opaque next-page cursor containing the resolved commit and offset. A subsequent page runs against that resolved commit rather than the then-current `HEAD`; it appends to the existing rows. A new explicit History refresh clears the cursor/rows and starts from the current HEAD.

This avoids duplicates and reordering when commits arrive while Load more is used. Offset paging is acceptable for a bounded, user-driven, read-only current-HEAD timeline and avoids exposing ref expressions to the browser. The server validates cursor shape, object IDs, and maximum page bounds before execution. Cursor state is not durable and is discarded on workspace eviction.

### 4. Use NUL-delimited machine-readable Git output for rows
Build history rows using a fixed `git log` format with NUL-delimited fields (complete SHA, parent SHAs, author/display timestamp, subject/body fields as required). Parse that format locally and reject malformed output instead of interpreting line-oriented commit messages. Limit each page and preserve Git's reverse-chronological reachability order, including merge commits.

Human-formatted `git log` is tempting but a subject/body can contain newlines or separator-like text. NUL framing has the same path/message safety rationale as the existing porcelain parsers.

### 5. Inspect immutable object IDs and use an explicit combined merge diff
A selected history item sends its complete commit object ID to `commit-diff`. The backend validates it as a commit reachable from the history snapshot/current workspace before rendering. Ordinary commits use `git show` with stable no-external-diff/no-colour options. Merge commits use Git's combined-diff form (`--cc`) and the response marks the merge metadata, so the viewer identifies the comparison semantics.

First-parent diffs were rejected because they discard the all-parent merge semantics chosen for this feature. Rendering no merge patch contradicts selection as an inspection action. Per-parent patches would be more exhaustive but multiply the UI and data volume; they are deferred.

The current unified-diff parser must be extended only where combined-diff syntax differs; metadata is rendered as a separate commit header instead of being inferred from patch headers.

### 6. Use explicit history load states and no cross-context retention
Each `GitWorkspaceUiState` gets independent history state: initial/page loading, loaded snapshot/rows/cursor, selected commit/diff, error, and request sequence. Requests capture the workspace key and sequence; completions update only retained matching state. Switching modes does not make an unfinished request an empty result. Refresh/retry actions visibly disable or identify their in-flight state.

This is deliberately separate from status state. Sharing a status-derived `stale` or empty sentinel would reintroduce the ambiguity that prompted the feature.

### 7. Persist shareable Git navigation state in its plugin namespace
The app route already owns machine, project, workspace, tool, and view. The Git plugin adds namespaced URL fields only for stable user-selected state: Changes/History mode, selected Changes path or History commit object identifier, and expanded review layout. Route restoration reads those values before panel requests begin; every panel selection writes the corresponding route. Browser history uses the same restoration path.

Loading/error state, pagination cursors, and retained response data do not enter the URL because they cannot reliably reproduce the reader's surface. A selected commit outside the first page is read by its immutable object ID; the backend remains responsible for reachability validation and reports an unavailable diff rather than silently selecting another commit.

This establishes the plugin route-state pattern for other workspace features. They must use their own namespaced, scope-checked fields rather than adding Git-specific state to the app route.

### 8. Expanded Changes is a viewport-driven multi-file review
The ordinary narrow panel keeps its single-file viewer. Expanded Changes renders a stable file navigator beside ordered lightweight review sections. Each section owns staged and unstaged diff state and an explicit unrequested/queued/loading/loaded/error lifecycle. An `IntersectionObserver` queues sections within a prefetch margin; navigator selection raises that file to the front and requests a semantic scroll target. The controller caps active files at two, so each may issue its staged and unstaged reads without an unbounded repository-wide fan-out.

Per-file and expand/collapse-all fold state remains scoped to the retained workspace controller and is deliberately absent from the URL. Only the focused file path is shareable: reopening the route reconstructs the default-expanded review, prioritizes that path, and lets viewport loading fill the rest.

## Risks / Trade-offs

- [Large repositories or expensive history/diff invocation] -> Limit page size, use existing subprocess timeout/output caps, surface truncation/unavailability honestly, and require explicit Load more.
- [HEAD changes during reading] -> Freeze pagination to the first response's resolved commit; only explicit refresh adopts a newer HEAD.
- [Commit messages contain delimiters/newlines] -> Use fixed NUL-delimited Git output and strict parser validation.
- [A commit is pruned or unavailable after list load] -> Preserve the selected row, report an attributable diff error, and permit retry rather than rendering an empty patch.
- [Combined merge diff has unfamiliar formatting] -> Label merge semantics in the viewer and add parser fixtures for standard, rename, and no-content merge cases.
- [Mobile toolbar becomes crowded] -> Design the mode control and secondary Changes controls at the established coarse-pointer floor; validate at 393x850 before merge.

## Migration Plan

1. Ship the browser and server Git plugin updates in the same package revision; the existing backend revision handshake prevents an unmatched browser from calling a stale daemon.
2. No durable state or data migration is required. Existing Git diff deep links continue to open Changes; History routes add mode and commit fields and default safely when those fields are absent.
3. If a deployment needs rollback, deploy the prior paired package and restart both web/API and session daemon. A browser reload discards ephemeral History state. No repository data has been changed.
