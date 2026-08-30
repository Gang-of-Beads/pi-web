## Context

The four-state pattern already exists twice in this codebase and works:
`SessionList.sessionsLoad` (`"unloaded" | "loading" | "loaded"`,
SessionList.ts:45, empty claim gated on `"loaded"` at line 200) and
ProjectList's four-state + Retry from v1.202608.69. The goals and activity
panels predate that discipline and violate it in five distinct, code-verified
ways:

1. **The goals loading flag is dead wire.** `workspaceGoalsLoading` exists in
   state (appState.ts:158) and is set by the controller
   (workspaceController.ts:112), but the prop chain at PiWebApp.ts:3128 never
   passes `.goalsLoading`. The GoalPanel's "Loading goals…" branch
   (GoalPanel.ts:103) is unreachable in the live app; every in-flight moment
   renders as one of the two terminal strings.
2. **A key mismatch collapses to `[]`.** `goalsForSelectedWorkspace`
   (appState.ts:263-265) returns `[]` when `workspaceGoalsKey` does not equal
   the current selection key. The panel cannot distinguish that `[]` from a
   completed read that found nothing, and renders "No goals recorded for this
   workspace" - the owner's screenshot, while the goal file was active on disk
   and a continuation for it was arriving in the same conversation.
3. **Goal reads cover one root; goals can live in another.** The server reads
   `<workspace.path>/.pi/goals/` (workspaceContext.ts:19, goalStore.ts:38) while
   the pi-goal extension records under the **session's cwd**. When they differ,
   the read succeeds over the wrong directory and returns `[]`.
4. **Background-task attribution is a transcript regex.** `taskIdsForSession`
   (backgroundTasks.ts:104-120) scans the transcript for
   `Output: .pi/tasks/<dir>/<id>.output` lines; an unreadable transcript is
   swallowed into an empty set (lines 107-111), and compaction can prune the
   line entirely. The pid-identity check itself is sound (verified separately:
   922 ms delta against a 60 s tolerance) - attribution is the broken half. The
   registry's own directory names already encode the owning session
   (`session-<id>-<id>`), so the durable attribution source exists and is
   unused.
5. **Absence and failure render as definite claims.** `activity === undefined`
   renders "No subagent or background activity from this chat yet."
   (ChatView.ts:1484-1491) - a claim about a chat whose activity was never read.
   The first-poll failure path retains state, so the claim survives as long as
   the failure does. Session-to-session switches within a workspace do not
   clear `subagents`/`backgroundTasks`/`activity` (only machine and workspace
   switches do, via `resetWorkspaceScopedState`, appState.ts:278), so the
   previous session's rows can render under the new session until its first
   poll lands - unkeyed retention across a key change.

A survey of the remaining definitive-empty surfaces, with what each can tell
apart today: SessionList - unloaded/loading/loaded, failure surfaces via the
error notice (partial); ProjectList - all four + Retry (the reference);
notifications - loaded vs not-loaded via two different strings
(ChatView.ts:1591-1593), no failed state; StatusBar - "No session status yet"
for undefined (honest wording, no failed state); QuickSwitcher and
ProjectDialog search - explicit failed states (honest). Forty-two
`role="status"`/empty-class sites exist across the client; this change covers
the four panels with proven false claims and names the vocabulary the rest
migrate onto when touched.

## Goals / Non-Goals

Goals: one named four-state vocabulary with its key, applied to goals, activity,
notifications; registry-side task attribution; root-covering goal reads. The
empty claim becomes provable: reachable only through a completed, matching read.

Non-Goals: panel visual redesign; transcript freshness; changing the
notification drawer's retention beyond a failed state; migrating all
forty-two empty sites (only the four with proven false claims, plus the shared
vocabulary others adopt later).

## Decisions

**D1 - One keyed load slot type, not per-panel flags.** Replace
`workspaceGoals` + `workspaceGoalsKey` + `workspaceGoalsLoading` +
`workspaceGoalsFailed` with a single `PanelLoad<T>` slot:
`{ state: "unloaded" | "loading" | "failed" | "loaded"; key: string | undefined; data: T }`.
Why: the four flags are three more ways to forget one - the dead
`.goalsLoading` wire exists precisely because the props travel separately.
Alternative considered: keep flags and pass the key down for the panel to
compare - rejected, it re-implements the gate per panel and has already been
gotten wrong once.

**D2 - Panels receive the slot; the empty claim gates on it.** GoalPanel's props
become one `goalsLoad` slot; the "No goals recorded" branch requires
`state === "loaded"` and a key match. The key-match gate
(`goalsForSelectedWorkspace`) is replaced by the slot's own state: a mismatched
read is `unloaded` for the new selection, which renders a loading line.

**D3 - Attribution moves to the registry directory name.**
`listBackgroundTasks` derives the owning session from the `session-<id>-…`
registry directory; the transcript regex runs only as a fallback for records
whose directory predates the naming scheme. Why over fixing the regex: the
directory is written when the task starts, is not rewritten by compaction, and
is the same source the registry read already walks - one read, one truth.
Unreadable individual records render as `unknown`, not absent.

**D4 - Goal reads union the roots, labelled.** When the focused session's cwd
differs from `workspace.path`, the response includes records from both, each
carrying `sourceRoot`; the panel appends the root as a quiet qualifier when
more than one root contributed. Alternative: read only the session cwd when it
diverges - rejected, it hides goals recorded beside the workspace.

**D5 - Failure keeps matching rows, names itself.** On a failed re-read, rows
whose key still matches stay visible under a failure line (the pattern the
goals controller already follows for its own retries); a failed first read
shows only the failure. Never an empty claim, never mismatched rows.

## Risks / Trade-offs

- [Union reads could double-list a goal present in both roots] → records are
  keyed by goal id; a goal found in both roots is listed once with the
  workspace root as its source.
- [Directory-name attribution breaks if the registry naming scheme changes] →
  the naming scheme is load-bearing for task storage today; the transcript
  fallback stays as a safety net, and a mismatch between the two sources
  surfaces as an `unknown` row rather than silence.
- [`PanelLoad` migration touches several call sites at once] → the slot lands
  per panel (goals first, then activity, then notifications), each task
  independently green; no flag remains after its panel migrates.
- [Extra root read adds latency to the goals request] → both reads are two
  directory listings against local disk, bounded by the existing
  `MAX_GOAL_FILES` cap; measured before and after on 8505.

## Migration Plan

Land per task, each behind its own commit: goals slot (client), task
attribution (server), root union (server + client label), activity unknown
state, notification failed state. Rollback is per-commit revert; no data
migration, no protocol break - response fields are additive.

## Open Questions

None that change the specs or the breakdown. The owner may veto D4's union
(and prefer a divergence notice instead) without affecting the other tasks; if
so, task 4.1 narrows and the spec scenario "A goal lives beside the session"
is amended before apply.

## Measured results (5.2, live legs completed)

- **Activity strip**: a real background task ("Sleep Timer", GLM-started) showed as "Task ... Running 1m 48s" with "Activity · 1 running" and running-only chips; "Nothing running right now." correctly absent (/tmp/n2-22-running.png).
- **Failed activity read**: with the daemon stack down, the panel rendered "Activity could not be loaded. It will retry automatically." — the failure this change exists for, caught live rendering the present-tense empty before the fix (/tmp/n2-44a-real-failure.png vs /tmp/n2-44a-fixed.png), recovered automatically (/tmp/n2-44a-recovered.png).
- **Cross-session**: switching the two seeded sessions showed each panel's own honest state, zero foreign rows (/tmp/n2-44b-switch.png; both empty at the time — the keyed-retention fix stands, a rows-present run would strengthen).
- **Goals read failure**: chmod 000 on the goals directory now yields a failed read (HTTP 400 after 1fbed1a8) and the client's "Couldn't read goals" state — before the fix the server swallowed the EACCES into a successful empty and the panel claimed "No goals recorded" (/tmp/n2-53c-chmod000.png is the before).
- **Goals switch**: two workspace switches sampled at 100ms — zero false "No goals recorded" claims during flight (/tmp/n2-53a-switch.png).
- **Registry attribution**: /compact ran with a task running — the panel still listed "Task Sleep Timer 2 Running 2m 8s" with the elapsed timer live (/tmp/n2-53b-compact.png).
- **Open item**: the divergent-cwd source-qualifier scenario is design-blocked (divergent sessions are UI-unreachable; recorded in task 3.3).
