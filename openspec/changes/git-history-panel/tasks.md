## 1. Git history backend contract

- [x] 1.1 Add Git history and selected-commit-diff operation types, validated browser contracts, and bounded request inputs/responses; verified with focused contract-parser tests and `npm run typecheck`.
- [x] 1.2 Implement current-HEAD, 50-entry snapshot-paginated history in the Git backend using strict NUL-delimited parsing, including unborn-HEAD and malformed-output behavior; verified with focused backend fixture tests covering ordinary commits, merge commits, multiline/special-character messages, pagination, and no commits.
- [x] 1.3 Implement selected commit metadata and ordinary/combined-merge diff retrieval without mutation, with reachability/input validation and attributable failure behavior; verified with focused backend tests covering normal commits, merge commits, invalid/unreachable IDs, missing objects, and output truncation.

## 2. History panel state and interaction

- [x] 2.1 Add Changes/History main-mode state scoped to machine/project/workspace while retaining List/Tree only inside Changes; verified with focused Git-panel tests that mode changes preserve Changes layout/status semantics and a clean status still renders `No changes.` only in Changes.
- [x] 2.2 Add explicit, selection-scoped History loading, loaded, unborn/empty, error/retry, refresh, and load-more states; verified with controller/panel tests that stale completions after a workspace change neither render nor become actionable, and that a frozen snapshot appends without reordering.
- [x] 2.3 Render commit rows and selected commit metadata/diff in the Git viewer, including a labelled combined merge diff and distinct loading/empty/error states; verified through happy-dom user interactions and unified-diff parser fixtures.
- [x] 2.4 Persist and restore the Git mode, selected diff or commit, and expanded layout through namespaced, workspace-scoped URL state; verified with focused URL serialization and panel interaction tests.
- [ ] 2.5 Validate the completed Git panel in a real browser at 393x850 with a coarse pointer: record the viewport, mode-control and row target sizes, verify History from a clean checkout, normal and merge diff viewing, Load more, error/retry, deep-link restoration, and return to Changes; inspect daemon logs to confirm history requests remain read-only and report the observed evidence.

## 3. Release and integration verification

- [x] 3.1 Add a patch Changeset describing read-only Git commit history and commit-diff inspection; verified the package name and fragment syntax with `npm run changelog:status`.
- [ ] 3.2 Run `npm test -- --run` for all affected Git plugin tests, `npm run typecheck`, lint for changed TypeScript files, and `npm run verify`; record exact results, investigate any failure, and commit each independently green task before opening the implementation PR.
