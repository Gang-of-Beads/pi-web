## Why

The Git workspace panel currently establishes only the working tree and index state. Once changes are committed, the truthful result is `No changes.`, but a user must leave PI WEB for a terminal to inspect the commits that produced the current checkout. The panel needs a read-only history surface scoped to the selected machine, project, and worktree, without making an empty change list incorrectly imply that a repository has no history.

The current empty-state producer is singular: `renderFileList` in the bundled Git browser plugin renders `No changes.` after the Git status backend has successfully returned an empty `files` array. The status backend intentionally produces only working-tree/index entries (`git status --porcelain`); it has no commit-history producer. The new history read must therefore be a separate backend operation and an explicitly selected panel mode, rather than an alteration to status or its empty state.

## What Changes

- Add a read-only **History** main view alongside **Changes** in the Git workspace panel. List and Tree remain layout choices inside Changes rather than becoming competing history views.
- List a bounded, incrementally loadable timeline of commits reachable from the selected worktree's current `HEAD`, including merge commits; do not fetch, push, or otherwise mutate Git state.
- Let the user select a commit to inspect its metadata and complete commit diff in the existing viewer area.
- Make loading, empty/unborn-history, and error states explicit and scoped to the current machine/project/workspace so stale history cannot be rendered or acted on after selection changes.
- Preserve the existing Git status/diff behavior and its `No changes.` meaning.

### Non-goals

- Browsing commits reachable only from other local or remote refs, first-parent-only filtering, search, author/path filtering, branch switching, or a commit graph.
- Any Git mutation: fetch, pull, push, checkout, staging, committing, reverting, or conflict resolution.
- Replacing the terminal for advanced history inspection or changing non-Git workspace behavior.

## Capabilities

### New Capabilities
- `git-history-panel`: Read-only, current-HEAD commit history and selected-commit diff inspection in the Git workspace panel.

### Modified Capabilities

- None.

## Impact

- Bundled Git plugin: `pi-web-plugins/git/git-backend.ts`, `server-plugin.ts`, shared browser contract, and `browser/git-panel.ts`.
- The provider backend request protocol gains Git-specific history and commit-diff operations but no generic protocol or configuration changes.
- Focused Vitest coverage will cover Git command parsing/request behavior, panel state scope/mode transitions, and user-visible loading, empty, error, and selected-diff states. The implemented UI will also require a real-browser validation at 393x850 with a coarse pointer.
- This is a user-visible, package-shipped capability and requires a patch Changeset when implementation begins.
