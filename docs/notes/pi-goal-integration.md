# Working with the pi-goal-x extension

How pi-web may read and change goal state that another process owns. Written
for the goal panel work; the rules here are the difference between "clearing a
goal" and "clearing a goal that comes back".

Verified against `pi-goal-x` as installed at
`~/.pi/agent/npm/node_modules/pi-goal-x` (source under `extensions/`).

## Who owns what

The extension runs inside the pi agent process and owns every write to
`<workspace>/.pi/goals/`: the goal records, the append-only ledger
(`goal_events.jsonl`), the ledger checkpoint, the lock directory, and
`archived/`. pi-web is a second process with no IPC to it: `pi-goal-x` ships no
`bin`, no daemon, no socket. The entire cross-process surface is **files plus
slash commands sent into a session**.

pi-web therefore reads files, and asks the agent to make changes.

## Facts that constrain the design

1. **A running agent does not see our writes.** Goals are served from an
   in-memory pool cache; external changes are invisible until `session_start`
   or `/goal-refresh` (`storage/goal-files.ts:520-527`, `goal-service.ts:283`).
2. **A turn boundary overwrites our writes.** `flushTurn` re-reads the file,
   takes the disk revision as its base and writes the in-memory record over it
   with no conflict check (`goal-service.ts:207-219`). Editing objective, status
   or tasks from pi-web while a turn is running is silently lost.
3. **Deleting the file resurrects the goal.** If the active file is gone at turn
   end, `flushTurn` recreates it from memory (`goal-service.ts:209-213`). A naive
   "delete the file" clear brings the goal back on the next turn.
4. **Outside a turn, writes are conflict-checked.** `apply` refuses on a revision
   mismatch and reports it (`goal-service.ts:410-421`), so a well-formed write
   between turns is safe.
5. **The objective is parsed from the prose, not the JSON.** A JSON-only edit is
   reverted on the next read (`goal-files.ts:425-473`).
6. **The pool snapshot is not truth.** `~/.pi/.goals-pool-snapshot.json` lives
   outside the goals directory and is only invalidated by directory mtime or
   filename-set changes; in-place edits do not invalidate it.
7. **Focus is session state, not file state** (`goal-state.ts:397-400`). No file
   makes a goal focused, so pi-web cannot focus one.
8. **`/goal-clear` is UI-gated.** It returns early when `!ctx.hasUI` and then
   requires `ctx.ui.confirm` (`goal-commands.ts:544-548`). `/goal-pause`,
   `/goal-resume`, `/goal-refresh` and `/goal-unfocus` are headless-safe.
9. **Writes are atomic** (temp + rename) everywhere that matters, so a reader
   never sees a half-written record.

## The contract pi-web follows

| Action | Mechanism | Notes |
|---|---|---|
| List and show goals | Read `<workspace>/.pi/goals/active_goal_*.md` | Already implemented in `src/server/web/goals/`. Never read the pool snapshot. |
| Show recently archived | Read `<workspace>/.pi/goals/archived/*.md` | Optional; keeps a cleared goal recoverable in the UI. |
| Live updates | Poll the goals directory mtime | Every turn boundary rewrites the focused record, so expect churn. |
| Pause / resume | Send `/goal-pause` / `/goal-resume` into a session for that workspace | Headless-safe when a goal is focused; keeps ledger and accounting correct. |
| Unfocus | Send `/goal-unfocus` | Headless-safe. |
| Archive / clear | `/goal-clear` when the session has a confirmable UI; otherwise the locked archive protocol below, followed by `/goal-refresh` and `/goal-unfocus` | See the empirical check. |
| Focus a specific goal | Not supported | UI-gated and session-only; `/goal-focus` ignores its argument today. Upstream gap. |
| Edit objective, tasks or status | Never from pi-web | Point 2. The agent owns these. |

### What was implemented

The container has no `pi-goal-x` installed, so `/goal-clear` cannot be driven
there at all, and a web session has no confirmable UI even where it is. pi-web
therefore implements the fallback protocol in `src/server/web/goals/goalArchive.ts`,
exposed as `POST .../workspaces/:workspaceId/goals/:goalId/archive`, and the
panel offers it behind a two-press confirm. The response carries
`agentMayRecreate`, and the UI repeats it: a session already working the goal
keeps its own copy until it reloads.

### Empirical check before implementing archive

pi-web's own project-trust context sets `hasUI: false`
(`src/server/daemon/sessions/piSessionService.ts:840-850`), but the *command* context a
session hands to an extension is built by the pi agent, not by pi-web. Run
`/goal-clear` in a pi-web session against a workspace that has an open goal:

- If it opens a confirm and clears, drive the agent and stop here. This is the
  safest option: correct ledger events, focus teardown, cache coherence.
- If it answers "Run /goal-clear in an interactive session to confirm clearing",
  use the fallback protocol.

### Fallback: archive from pi-web directly

Only with the whole protocol; a partial version is worse than doing nothing.

1. Acquire `<workspace>/.pi/goals/.locks/<goalId>.lock` with `flag: "wx"`,
   honouring the extension's staleness rule (30 s, or a dead pid). Hold it for
   well under 100 ms: the agent's persist path waits ~100 ms for the same lock
   and silently defers when it cannot get it.
2. Re-read the active file under the lock and capture its `revision`. Refuse if
   the file is gone.
3. Write `archived/goal_<ts>_<goalId>.md` with the **JSON header and the prose
   body** (point 5), `status: "paused"`, `stopReason: "user"`,
   `revision: captured + 1`, `archivedPath` set and `activePath` removed, using
   temp + rename.
4. Unlink the active file.
5. Append one `goal_archived` record to `goal_events.jsonl`.
6. Delete `~/.pi/.goals-pool-snapshot.json` rather than editing it: a missing
   snapshot only costs a rescan, a stale one lies (point 6).
7. Release the lock, then send `/goal-refresh` and `/goal-unfocus` into any live
   session for that workspace, so a running agent drops its cached copy and
   cannot recreate the record at its next turn boundary (point 3).

Preconditions worth enforcing in the UI: prefer archiving when the session is
idle, and say plainly in the confirm dialog that this changes state the agent
owns.

## Consequences for the panel

- A paused goal is not a finished goal, so it stays at the top of the list
  forever with no way out. The panel needs an explicit action, which is what
  this contract enables.
- The action is destructive and cross-process, so it confirms first and reports
  the mechanism it used.
- Read-only remains the default: everything except pause, resume, unfocus and
  archive stays with the agent.
