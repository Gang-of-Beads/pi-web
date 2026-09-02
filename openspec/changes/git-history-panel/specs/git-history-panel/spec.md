## Purpose

Provide a read-only, worktree-scoped Git commit history so users can inspect the commits behind a clean or changed checkout without leaving PI WEB.

## ADDED Requirements

### Requirement: Git panel separates workspace changes from commit history
The Git panel SHALL provide **Changes** and **History** main views for a Git-owned workspace. Changes SHALL retain List and Tree as its file-layout choices and SHALL retain its existing status meaning, including `No changes.` only for a successfully loaded empty working-tree/index result.

#### Scenario: User opens History from a clean checkout
- **WHEN** the Git workspace has no working-tree or index changes and the user selects History
- **THEN** the panel SHALL load commit history rather than treating the clean Changes result as an empty history

#### Scenario: User returns to Changes
- **WHEN** the user selects Changes after viewing History
- **THEN** the panel SHALL restore the Git status surface and its selected List or Tree layout without changing repository state

### Requirement: History is scoped to the selected worktree current HEAD
The History view SHALL list commits reachable from the selected workspace's current `HEAD`, including merge commits. It SHALL not fetch from remotes, mutate Git state, or list commits reachable only from other refs.

#### Scenario: Selected workspace determines history
- **WHEN** two selected workspaces resolve to different current commits
- **THEN** each History view SHALL show commits reachable from that workspace's own current HEAD

#### Scenario: History has more commits than its initial page
- **WHEN** the reachable history exceeds the initial bounded result
- **THEN** the panel SHALL offer an explicit user action to load the next page and SHALL append that page to the same history snapshot

#### Scenario: Current HEAD has no commit
- **WHEN** the selected Git workspace has an unborn HEAD
- **THEN** History SHALL state that the repository has no commits yet

### Requirement: History loading and failures are honest and selection-scoped
The History view SHALL distinguish loading, successfully empty/unborn, loaded, and failed results. A history result, selected commit, or commit diff SHALL render only while its machine, project, and workspace match the active panel context.

#### Scenario: First history read is pending
- **WHEN** History has been selected and its first request is in flight
- **THEN** the panel SHALL identify the history as loading and SHALL NOT claim that it is empty

#### Scenario: History request fails
- **WHEN** a history request fails
- **THEN** the panel SHALL show that history is unavailable with the attributable failure reason and SHALL provide a retry action

#### Scenario: Workspace changes during a history request
- **WHEN** the selected machine, project, or workspace changes before a history or commit-diff request resolves
- **THEN** the response SHALL NOT render or be actionable in the newly selected context

### Requirement: User can inspect a listed commit without mutating Git state
Selecting a listed commit SHALL show its commit metadata and diff in the Git viewer. For an ordinary commit, the viewer SHALL show its full patch; for a merge commit, it SHALL show a combined diff against all parents. The panel SHALL represent a successful empty diff distinctly from a loading or failed diff.

#### Scenario: User selects an ordinary commit
- **WHEN** the user selects a non-merge commit in loaded History
- **THEN** the viewer SHALL show its subject, author, timestamp, complete object identifier, parent identifier or identifiers, and full patch

#### Scenario: User selects a merge commit
- **WHEN** the user selects a merge commit in loaded History
- **THEN** the viewer SHALL identify it as a merge and show a combined diff against all of its parents

#### Scenario: Selected commit changes multiple files
- **WHEN** a selected ordinary or merge commit patch contains multiple file boundaries
- **THEN** the viewer SHALL render a separately headed, independently collapsible diff section for each file rather than one undifferentiated patch table, and SHALL provide expand-all and collapse-all actions

#### Scenario: Selected commit diff cannot be read
- **WHEN** the selected commit diff request fails
- **THEN** the panel SHALL retain the selected commit identity, state that its diff is unavailable with the failure reason, and offer retry without claiming an empty diff

### Requirement: Git navigation state is shareable and restored from its scoped URL
The Git panel SHALL encode its selected mode, selected Changes diff path or History commit identifier, and expanded review layout in its plugin-namespaced URL state. The panel SHALL restore that state on page load, refresh, and browser history navigation only when the URL machine, project, and workspace match the active panel context.

#### Scenario: User shares a selected History commit
- **WHEN** a user selects a commit in History
- **THEN** the URL SHALL identify History and the selected complete commit object identifier, and opening that URL for the same worktree SHALL reload History and inspect that commit

#### Scenario: User returns through browser history
- **WHEN** browser back or forward changes the Git panel URL state for the active workspace
- **THEN** the panel SHALL restore the encoded mode, selection, and expanded layout without retaining an action from the later route

#### Scenario: A shared route selects an unavailable commit
- **WHEN** a shared History URL identifies a commit that cannot be read from the selected worktree
- **THEN** the panel SHALL show an attributable unavailable-diff state without substituting another commit

### Requirement: Expanded Changes provides a bounded multi-file review surface
The expanded Changes layout SHALL retain a file navigator beside ordered per-file diff sections. Diff sections SHALL load on demand near the viewport with bounded concurrency, while a file explicitly selected in the navigator SHALL be prioritized, scrolled into view, and represented as the shareable URL anchor.

#### Scenario: Expanded review opens with many changed files
- **WHEN** the user expands Changes for a workspace with many changed files
- **THEN** the panel SHALL render lightweight file sections without immediately requesting every diff, and SHALL prioritize sections in or near the viewport

#### Scenario: User selects a file that has not loaded
- **WHEN** the user selects a file in the navigator
- **THEN** its section SHALL scroll into view, move ahead of ordinary visible work in the bounded queue, and independently show queued, loading, loaded/empty, or failed/retry state

#### Scenario: User folds review sections
- **WHEN** the user collapses one or all file diff sections
- **THEN** their temporary fold state SHALL remain in the current workspace review session but SHALL NOT be added to the shareable URL
