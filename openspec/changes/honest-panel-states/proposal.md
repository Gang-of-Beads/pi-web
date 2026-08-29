## Why

Two panels told the owner flatly false things about the present: the GOALS panel
said "No goals recorded for this workspace" while that workspace's goal file sat
on disk, active, driving a continuation into the very conversation on screen;
the activity panel said "Nothing running right now" while a background task it
itself had started was running. Both breaks are the same break, and this
repository wrote the rule down after paying for it before: **absence is not
negation**. An empty result must distinguish not-loaded, failed,
key-mismatched and genuinely-empty, and must never render the last of those
when it means one of the first three.

## What Changes

- Panel load state becomes a named, four-way vocabulary (`unloaded`, `loading`,
  `failed`, `loaded`) carried **with the key the data answers for**, modelled on
  the `sessionsLoad` slot the session list already has and the four-state
  ProjectList already ships.
- The goals panel stops rendering "No goals recorded" from a `[]` it cannot
  explain: the loading flag is actually wired (today `workspaceGoalsLoading`
  exists in state and never reaches the panel), a key mismatch renders as not
  loaded rather than as empty, and a successful read that found nothing may
  make the empty claim.
- Goal reads stop silently reading one root when the goal may live in another:
  when the workspace root differs from the focused session's working directory,
  both are read and each goal carries the root it came from.
- Background-task attribution stops depending on a regex over the session
  transcript: the task registry's own directory name already names the owning
  session, so an unreadable or compacted transcript can no longer hide a
  running task.
- The activity panel stops rendering a definitive "No subagent or background
  activity from this chat yet." when the activity snapshot is merely absent,
  and stops showing the previous session's rows (or an empty claim) for a
  session whose first read has not succeeded.
- **BREAKING** for anything keying off the panel text: the empty strings move
  behind explicit load states, and "No goals recorded for this workspace" can
  no longer appear while a read is in flight, has failed, or answers for a
  different selection.

## Capabilities

### New Capabilities

- `chat/panel-load-honesty`: the four-way load vocabulary, the rule that an
  empty claim requires a completed read that answers for the current key, and
  the per-panel guarantees for goals, activity, background tasks and
  notifications.

### Modified Capabilities

None. This repository has no archived specs yet; the neighbouring changes in
flight (`steady-surface-and-visible-actions`, `warnings-belong-in-notifications`)
cover movement and warning delivery, not load-state honesty.

## Impact

- `src/client/src/components/GoalPanel.ts` - empty-state rendering gains the
  four-way distinction.
- `src/client/src/components/PiWebApp.ts` - `.goalsLoading` is never passed today
  (the prop chain at line 3128); the panel load state replaces the three loose
  props.
- `src/client/src/components/ChatView.ts` - activity empty rendering
  (`renderSessionActivity`, line 1484) and the "Nothing running right now" scope
  (line 1509).
- `src/client/src/appState.ts` - `workspaceGoalsKey`/`workspaceGoals`/
  `workspaceGoalsLoading`/`workspaceGoalsFailed` collapse into one keyed load
  slot; `goalsForSelectedWorkspace` (line 263) stops collapsing a key mismatch
  into `[]`.
- `src/client/src/controllers/workspaceController.ts` and
  `sessionController.ts` - writes to the new slot; session switch clears or
  re-keys `subagents`/`backgroundTasks`/`activity` (today only machine and
  workspace switches do, via `resetWorkspaceScopedState`, appState.ts:278).
- `src/server/goals/goalStore.ts` and `workspaceExplorerRoutes.ts` - goal
  responses carry the root each record came from; a divergent session cwd is
  read instead of silently skipped.
- `src/server/sessions/backgroundTasks.ts` - `listBackgroundTasks` (line 199)
  attributes via the registry directory name (`session-<id>-…`), with the
  transcript scan (`taskIdsForSession`, line 104) as a legacy fallback only.
- `src/shared/apiTypes.ts` - additive response fields only (goal record source
  root), per the standing constraint on server data formats.

## Non-goals

- Redesigning the goals panel, the activity panel, or the notification drawer
  beyond their load states.
- Changing when goals are written, or which conditions raise an activity row.
- Fixing transcript freshness (the session daemon's in-memory runtime, s23) -
  attribution no longer depends on the transcript's live tail, but transcripts
  still do not refresh an open page.
- The notification drawer's retention behaviour beyond adding an explicit
  failed state to its fetch.
- Any release step; this change lands through the normal per-task commit flow.
