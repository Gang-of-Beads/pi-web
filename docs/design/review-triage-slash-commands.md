# Review triage: slash commands read like messages (goal task 5)

Commits under review: d5f527cb, 0d89d2f3 (+ fixes below). Two glm
max-thinking lanes, split state/vocabulary vs surface/geometry/tests. The
tree moved under both lanes (the `accepted` state landed mid-review); each
adjudicated against the live files.

| # | Lane finding | Adjudication | Action |
| --- | --- | --- | --- |
| S1 | Commit d5f527cb contradicted its tests until 0d89d2f3 | TRUE, already folded | 0d89d2f3 landed the `accepted` state; the changeset now describes it |
| S2 | `/reload` while busy returned done+prose; the browser marked it Read though it runs on the idle edge | TRUE | Fixed: `CommandResult.done.deferred` is an explicit daemon marker (forwarded runtime command with active work, parked reload); `commandOutcomeFor` maps it to `accepted` and never guesses from prose |
| S3 | The deferred heuristic sampled the selected session's `isStreaming` when the answer landed, not the command's session | TRUE | Fixed: the heuristic is gone; the daemon says deferred |
| S4 | Result text lost for commands with no ledger row: the pending-start flush and `respondToCommand` | TRUE | Fixed: a command typed against a not-yet-started session routes through `runCommand`, the queued send carries its `ledgerId` and the flush settles it; a select dialog keeps its row live by requestId and the answer (or cancel, as Not sent) settles it. The rename dialog never showed its result before and still does not - the name itself is the receipt |
| S5 | "the model never sees it" is false for runtime commands | TRUE | Fixed: changeset, module doc and design §3.1 scope the claim to built-in commands |
| S6 | "Queued command needs input" mislabels a run-and-asking command | TRUE | Fixed: "is asking a question" |
| S7 | pending+idle reads Running before the request reached the daemon | TRUE, accepted | Label now reads "sent to the daemon, which has not answered yet"; a separate Sending state is not worth a fifth mark for a sub-second window |
| S8 | accepted rows evictable under the cap while the work waits | TRUE | Fixed: `commandFinished` gates eviction; accepted counts as live |
| S9 | Comment rot from the deleted dismissal | TRUE | Fixed: orphaned docstrings, the withdraw rationale, the "queued-message gold" claim |
| U1 | accepted rows froze at Queued forever; nothing re-settled them | TRUE | Fixed: `settleAcceptedCommands` settles the session's accepted rows to Read on the runtime's idle edge (a forwarded command ran as the next turn; a parked reload ran on that edge); enumerated in `commandLedger.test.ts` and `sessionController.deferredCommand.test.ts` |
| U2 | Chronology: ledger rendered after queued messages though the daemon takes commands first | TRUE | Fixed: ledger renders before the pending/queued bubbles |
| U3 | Spec `action-acknowledgment` says commands "appear in the session transcript … until its result is known" | Adjudicated satisfied | The bubble appears in the transcript column from issue to result; no spec edit |
| U-Q1/Q2/Q4 | Missing header is a designed difference; fonts consistent; ChatView test exists | FALSE / correct | Verified by the lane |

Live: daemon rebuilt and restarted on 8505; `scripts/probe-command-bubbles.mjs`
PASS at 393x850 (/session reads Read with its stats, /new reads Not sent, no
dismiss, no overflow).
