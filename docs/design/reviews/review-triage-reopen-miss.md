# Review triage: B28 slice H2, a reopen is a miss too (with the H1 follow-up)

- **Commits:** `95b8e67e` (H2), with `b3bb3b28` (the H1 follow-up) as background.
- **Lanes:** two reviewers read a frozen worktree (`/tmp/pw-h2`) with the bob and ponytail lenses. Workflow `8ad0d933`.
  - Opus 5.5: OK with notes.
  - DeepSeek 4.1 max: OK with notes.

Each finding was settled by reading the source. Each fixed finding with a behavior change has a test that fails on `95b8e67e`.

## Fixed

| Lane | Finding | Verdict | Fix |
|---|---|---|---|
| Both, P2 | A machine switch hands the machine from one of its sockets to the other. Frames published during that handshake go to no socket, and the new socket's first open was not treated as a miss, so a session renamed meanwhile kept its old name while the board was fresh (30 s). | **True.** | The page decides, not the socket: `openMissedSome(machineId)` with a page-level set of machines heard. An open of a machine the page heard before is a miss, a reopen or a handoff alike; the page's first open of a machine is not. `RealtimeSocket` is back to its H1 form (the `opened` flag is deleted). Test: "reads again what the frames keep live on a reopen and on a handoff…". |
| Opus, P2 (ponytail); DeepSeek finding 6 | The reopen path kept a second read list beside the miss path, uncoalesced with it. | **True.** | A miss-open calls `rereadAnnounced` (coalesced per machine) plus the interrupted runs and the self-update check. The first open keeps its own list. |
| Opus, P2 | A reopen in a hidden tab invalidated panels nobody saw. | **True.** | `readAnnounced` goes through `applyWorkspaceChanged`, which defers while hidden and refreshes on return. Test: "leaves the open workspace panels to the hidden tab's return…". |
| Opus, P2 (H1 follow-up) | A replacing status read could retract an activity frame applied while it was on its way. The daemon dedupes unchanged activities, so the label did not come back until the next transition. | **True.** | Activity frames are marked on the same clock as status frames, and `activitiesAfterStatuses` keeps what the read cannot speak for (`keeps`). Test: "keeps an activity frame applied while a replacing read was on its way…". |
| DeepSeek, P2 (H1 follow-up) | A replacing read retracted the "Creating session" activity of a session this page is still starting: an id no catalog can list. | **True.** | `keeps` includes the page's pending starts. Unit: "keeps what the read cannot speak for". |
| DeepSeek, ponytail | `applyStatus` scanned the whole activity map per status frame, and the result had a dead ternary. | **True.** | `activityOutlivesStatus(activity, status)`: the O(1) predicate both paths use. `activitiesAfterStatuses` returns `Object.fromEntries` directly. |
| Opus, ponytail | Two status-frame counters (`statusFramesApplied` for the selected session, the marks for all). | **True.** | One `frameClock`. `statusReadIsStale` reads the session's mark. `statusFramesApplied` is deleted. |
| Opus, P2 | The probe's control accepted zero board reads. | **True.** | `probe-reopen-heals` requires exactly one more board read. |
| DeepSeek, P2 | D5 cited P6a for the boot board read. | **True.** | D5 cites `loadQuickSwitcherData`. |

## Not fixed, with reason

| Lane | Finding | Verdict | Reason |
|---|---|---|---|
| DeepSeek | `workspace.changed` for a non-selected machine is dropped live and on a miss. | True; this is the design. | Panels belong to the selected machine. A switch reads them fresh. |
| Opus | `statusFrameMarks` is never pruned. | True, bounded. | It is bounded by the sessions that ever published on this page, one number each. |
| DeepSeek | No probe counts boot board reads. | True. | The unit test pins that the first open marks nothing. `probe-reopen-heals` pins one read per reopen. A boot board counter belongs with B28's budget probe (`probe-budgets`, maintenance). |

## Follow-up commit
- **Tests:** four new or changed tests fail on `95b8e67e`.
- **Mutants:** all nine killed.
  - KA, KB: the heard set never or always says heard.
  - KC, KD: the main or followed socket ignores a miss.
  - KE: panels not deferred.
  - KF: activity frames unmarked.
  - KG: `keeps` ignored.
  - KH: pending starts not kept. Killed by "keeps the activity of a session this page is still starting…", added after it survived.
  - KI: the selected read's staleness blind to frames. Killed by `sessionController.review-repro-realtime.test.ts`, outside the gate's first list.
- **Probes on 8505:**
  - reopen-heals 3/3, with exactly one board read;
  - missed-announcement 4/4;
  - boot-reads 11/11;
  - board-live 7/7;
  - pins-live 5/5.
- **Restart:** browser only; reload the page.
