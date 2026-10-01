# Review triage: B28 slice H1, a lost announcement is noticed

- **Commit:** `2dcf8caa`, "Notice a lost announcement on a machine's open socket".
- **Lanes:** two reviewers read a frozen worktree (`/tmp/pw-h1`) with the bob and ponytail lenses. Workflow `25220854`.
  - Opus 5.5: OK with notes.
  - DeepSeek 4.1 max: OK with notes, one P1.

Each finding was settled by reading the source. Each fixed finding with a behavior change has a test that fails on `2dcf8caa`.

## Fixed

| Lane | Finding | Verdict | Fix |
|---|---|---|---|
| DeepSeek, P1 | A lost `activity.update` was noticed but not healed. `hydrateSessionStatuses` replaced statuses but never touched `sessionActivities`, and only a status *frame* cleared a stale "active" activity (`applyStatus`). The daemon stops publishing activity once a session is idle, so the badge read WORKING for good. | **True.** The same hole existed on the reconnect read. | `activitiesAfterStatuses` (new `activityAfterStatus.ts`): one rule for a frame and for a read. An "active" activity whose status is not active, or whose session a replacing read no longer lists, is dropped. Tests: `activityAfterStatus.test.ts` and "drops an activity a replacing read shows is over…". |
| Opus, P2-2 | `hydrateSessionStatuses(replaceKnown)` could overwrite a status frame applied while the catalog read was on its way. It was pre-existing on reconnect; H1 adds a trigger in exactly the busy case. | **True.** | Each applied status frame marks its session on a frame clock. A replacing read keeps the frame for any session marked after the read began. Test: "keeps a status frame applied while a replacing read was on its way…". |
| Both, P2 | A burst of losses was not coalesced. Each miss started every read; about 5 reads per miss on a lossy link. | **True.** | `rereadAnnounced` goes through a `TrailingRefreshCoordinator` per machine: a synchronous burst shares one pass, and losses during a pass ask for at most one more. Test: "shares one pass of reads…" (5 losses, then 5 more mid-pass: 2 passes). |
| DeepSeek, P2 | The probe's "lost last" leg did not prove nothing else followed the drop. A frame of another kind would reveal the gap and pass the leg without testing the head. | **True.** | The probe records the frame types forwarded between the drop and the heal, and the leg requires them all to be keepalives. |
| DeepSeek, P2 | The terminal read was never asserted. | **True.** | The wiring test selects a workspace and expects `refreshActiveTerminals`. |
| Opus, P2-1, P2-5 | D5 said the board is read again "if shown", but the followed board stays the last one browsed (from boot on). D5 under-listed the reads. | **True.** | D5 now says which board is read at once and which on its next showing, and lists every read, the frame rule and the activity rule. |

## Not fixed, with reason

| Lane | Finding | Verdict | Reason |
|---|---|---|---|
| Both, ponytail | The open path and the miss path keep two read lists. A frame lost while the socket was down does not mark the board stale or invalidate panels on reopen. | True. | Folding the open into `rereadAnnounced` would force a whole board read at the first open of every page load, a second boot read that P6a removed (`probe-boot-reads`). Recorded in D5 as the next slice of B28: a reopen marks the board and the panels like a miss, without the first open's duplicate. |
| DeepSeek, ponytail | `currentGlobalSeq()` and `sendKeepalive()` have no production caller. | True, pre-existing. | Both are test seams that predate H1. `addGlobal` reads the field directly, like the keepalive. Not worth a third spelling. |

## Hunt items both lanes judged false
- A stale join `seq` (`addGlobal` registers and stamps in one synchronous call).
- A frame before the join frame.
- A proxy or gateway synthesizing or reordering global frames (the bridges are transparent and FIFO).
- A `seq` spent without a delivery or a reconnect (the full-buffer guard terminates the socket).
- A false gap from an older daemon.
- `onMissed` firing for the wrong machine after a switch.

## Follow-up commit
- **Tests:** they fail on `2dcf8caa` (see above).
- **Mutants and probes:** see the commit gate.
- **Restart:** browser only; reload the page. The daemon restart from `2dcf8caa` still applies.
