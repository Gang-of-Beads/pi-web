# Review triage: B49 slice a, a pinned session outlives its project

Review run `26ab00fa`, two lanes on `reviewer`:
- **Opus 5.5:** OK with notes, "not done until F1 is settled".
- **DeepSeek 4.1 flash max:** OK with notes, one P1.

Both lanes found the same P1 on their own. Each finding was checked against the source before triage.

| # | Finding | Lane | Verdict | Action |
|---|---|---|---|---|
| 1 | After a tap, the selection and the URL do not describe the session. On desktop they keep the project the reader was in, so the composer, the panels and the URL answer for that project. On the phone the URL is `?session=<id>`, and a reload opens nothing because `restoreRouteFor` returns as soon as the route has no project. | O-F1, D-F1 (P1) | **True.** `locateSessionWorkspace` answered `undefined` both for "nobody claims it" and for "someone did not answer", so the caller could not act on either. | **Fixed.** The place is typed `found \| outside \| unknown`. **outside** (every project answered, none owns the directory) empties the project and workspace selection and rewrites the URL; **unknown** moves nothing. A workspace also owns its subdirectories (the deepest one wins once every project answers), so a subdirectory session of an open project is not "outside". A route naming a session with no project opens it through the named-target machinery (`openSessionAlone`: a machine-wide locate from `/`), so a reload opens it, or says it is gone, in the machine's name. Tests: the lookup (8, all failing on HEAD), the controller (outside clears, unknown keeps), named target (opens / gone), view words without a workspace. Probe legs: the state and URL name the session alone; a reload opens it in no project. |
| 2 | Each locate is a fresh store-wide walk, outside the scanner's single flight, unbounded and uncached; a gone pin pays on every read. | O-F2, D-F5 | **True.** The brief's "shares the single flight" was wrong (`scanSessionSummariesInDirNow`). | **Recorded, not fixed.** 8504 has 7 pins in all, and a walk over the warm memo is stats. If it ever shows on a budget, one machine-wide read (`listAllSummaries`, already present) replaces N locates. What a gone pin should do is queued for the owner. |
| 3 | A pin whose locate timed out vanishes from PINNED while the board says "complete", and nothing asks again. | O-F3 | **True.** That is absence rendered as negation. | **Fixed.** An unknown pin is an `UnknownSource` of kind `pin`. The board is then partial, so it is read again on the backoff, and `completeSessionBoard` locates only that pin (`locatePin`, the daemon's machine-wide locate; gone drops it; no answer keeps it unknown). Mutants NI and NJ are killed. |
| 4 | A rename from the quick switcher does not reach a pinned-elsewhere row, and the navigate page's rename never patches the board. | O-F4, D-F3 | **True.** | **Fixed.** `applyRenameToQuickSwitcher` renames in `sessions` and `pinnedElsewhere`, and the navigate rename goes through it too (`renameListedSession`). |
| 5 | The navigate row menu's Rename runs against the selected machine, not the machine of the row. | D-F4 | **True, and older than this slice** (any browsed row). Archive and Delete are offered only when not browsing elsewhere. | **Fixed for Rename.** The dialog carries the machine of the row (the browsed one, or the selected one from the bar), and the rename runs there. Mutant NH is killed. |
| 6 | The quick switcher drops the browsed machine's pinned-elsewhere rows on another machine's tab. | D-F2 | **True.** | **Fixed.** The rows are filtered by the browsed machine's pins. On another tab they land by recency, because that tab's rows carry no badges by design. Mutant NF is killed. |
| 7 | One pinned entry without a session id refuses the whole board, so the page stops asking for it for its life. | O-F6, D-F6 | **True** (only against a server that omits the field). | **Fixed.** Such an entry is dropped. Mutant NK is killed. |
| 8 | A docstring was attached to the wrong function. | O-F5, D-F7 | **True.** | **Fixed.** |
| 9 | The probe could pass without the session living in the closed project, and it never reloaded. | D-F8 | **True.** | **Fixed.** A precondition checks that the located cwd is the project's folder, and a reload leg was added. |
| 10 | `boardFromAnswer` always set `pinnedElsewhere`, where `assembleBoard` omits it when empty. | D note | **True, harmless.** | **Fixed.** It is omitted when empty, everywhere. |

## Found while verifying: the locator never ran in production

The live probe of the fix failed on the desktop leg: the project stayed. Tracing the live page showed why. `selectSession` asked for the place before it set `selectedSession`, and the real catalogue (`whenAnswered`) checks `wanted()` at once. So it found no session selected and answered undefined, without a single request. The locator added for "a session opened from another project takes its project with it" (P1 slice 2) has therefore never placed a session whose project was not loaded. The unit tests missed it, because their catalogues ignored `wanted`.

**Fixed.** The place is asked for once the selection names the session. The test catalogues now honour `wanted`, as the real one does. A new test, "places a session from a project that was not loaded…", fails on HEAD and passes now.

## Not covered by a unit test

The `restoreRouteFor` branch that calls `openSessionAlone` is wiring in `PiWebApp`. Its behaviour is unit-tested in the controller, and the wiring is covered by the probe's reload leg (it failed on HEAD: nothing opened).

## Mutation

- First cut: MA–MJ, all killed.
- Fixes: NA–NK, all killed.

## Re-review of the fix wave (run 39f920d2, frozen worktree at 8571cf23)

- **Opus 5.5:** OK with notes, with two P1s.
- **DeepSeek 4.1 flash max:** BLOCK on one P1.

Both lanes agree on the P1. The placement runs in production for the first time, so its writes now matter.

| # | Finding | Lane | Verdict | Action |
|---|---|---|---|---|
| R1 | A placement into a found workspace never writes the URL, so the address and the history keep the project the reader left. | O-1, D-F1 (P1) | **True.** | **Fixed.** The selection's own write comes at the end of its first read. A placement that lands before that write leaves the write to it, so one entry names the placed project. One that lands after replaces that same entry. The outside branch uses the same rule. Test: "writes the placed project into the URL once…" (fails on HEAD, where the placed project never reaches the URL). Mutants PA, PB and PC are killed. |
| R2 | PiWebApp's three URL-writer callbacks dropped their options, so `replace` never took effect; an older replace (a pending start getting its real id) was dropped too. | O-2, D-F2 | **True.** | **Fixed.** The options are forwarded. Test: each controller's `replace` reaches `updateUrl`. Mutant PE is killed. DeepSeek's worry that a placement landing first would replace the reader's previous entry does not arise: under R1, a placement never writes before the selection does. |
| R3 | A placement still on its way can rewrite a URL the reader has already gone Back or Forward to. | D-F3, O-3 | **True.** | **Fixed.** Every route restore calls `yieldPlacement()`, and a yielded placement neither moves the page nor writes. Test: "stops a placement still on its way…". |
| R4 | A route naming only a deleted session, reached while another session is shown, says nothing and keeps the previous session on screen. | O-4, D-F4 | **True.** | **Fixed.** That route clears the selection before it opens the session alone. The route names only that session, so the page shows that session or why it cannot (D8, "the frame and its content change together"). Probe leg: Back to `?session=<deleted>` while a session is shown says "no longer exists" and shows no other session. |
| R5 | The lookup answered `found` (a containing workspace) while a project that might hold a deeper one had not answered. | O-5 | **True.** | **Fixed.** A containing owner is taken only once every project has answered; otherwise the answer is `unknown`. An exact match still wins at once. Mutant PD is killed. |
| R6 | A stale "unchanged" listing answer could mark a list loaded for a workspace the reader has left. | D-F5 | **True** (now reachable after `leaveOpenProjects`). | **Fixed.** The answer is guarded on the workspace it was asked for. Test: "does not mark a list loaded for a workspace the reader has left…". |
| R7 | An inline comment block, and an orphaned docstring. | O-6, D-F6 | **True.** | **Fixed.** The rationale now lives in `locateAndApplySessionWorkspace`'s docstring. |
