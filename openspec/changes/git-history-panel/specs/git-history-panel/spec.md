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

#### Scenario: Selected commit diff cannot be read
- **WHEN** the selected commit diff request fails
- **THEN** the panel SHALL retain the selected commit identity, state that its diff is unavailable with the failure reason, and offer retry without claiming an empty diff
