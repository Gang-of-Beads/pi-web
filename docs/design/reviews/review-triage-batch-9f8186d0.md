# Review triage: batch 4 (9f8186d0)

Commit reviewed: `54a9b5d6` (the jump and the restore ask through the decision). Lanes: Opus (`batch4-opus.md`) and DeepSeek (`batch4-deepseek.md`), both on the frozen worktree `/tmp/pw-batch4`, neither with a shell.

Verdicts: both "OK with notes". DeepSeek rated one finding P1 (row 1), which Opus also found as a P2; everything else is P2.

Both lanes judged FALSE, after reading: the walk never repeats without end (each step reads the newest page as of the server's answer), and the host never drops a jump's read in practice (the decision asks only when nothing is loading).

| # | Finding | Lanes | Verdict | Outcome |
|---|---------|-------|---------|---------|
| 1 | A remembered spot outlives the restore. A jump during a restore's read rewrote the resume to `following`, so the reader's later scroll no longer counted as ending a restore, the spot stayed armed, the missing branch re-armed it outside a restore, and a later page moved the reader to it. | DeepSeek F1 (P1), Opus F4 | True by reading. | Fixed: whatever ends the restore forgets the spot and cancels a queued restore frame (`dispatchViewport`, `forgetPendingRestore`); a missing spot re-arms only while restoring. Test fails on 54a9b5d6. |
| 2 | A disconnect cleared the hold's timer without releasing the hold, so a view put back stayed held with nothing to release it. | DeepSeek F2 | True. | Fixed: the disconnect releases the hold. Test fails on 54a9b5d6. |
| 3 | A failed jump re-applied the scroll rules at the hold's end, so a reader far from the end got nothing; the jump also left the reader pinned while the state read `holding`. | Opus F2, DeepSeek F3 | True. | Fixed: the hold owes the jump's newest page (`owedAfter`, `owes`), the hold's end asks for it wherever the reader is, a scroll during the hold drops the debt (`readerMoved`), and a failed read leaves the reader unpinned. Tests fail on 54a9b5d6. |
| 4 | A jump pressed while an older page was on its way was lost when that page landed. | Opus F3 | True; pre-existing, and the changeset said "from anywhere". | Fixed: an older page whose wait the jump took over goes on to the newest. |
| 5 | Any `messages` change while a page was awaited counted as that page's arrival (a delta replay or a frame during the read). | DeepSeek F4 | True. | Fixed: arrival is the read's own end, the loading mark going off with new messages in the same update (`settlePageRead`). Test fails on 54a9b5d6. |
| 6 | Keys and a scrollbar drag do not take over a restore, though D4 lists them as intent. | Opus 3, DeepSeek F5 | True. | Not changed: ChatView tags only its follow scrolls as its own, so "a scroll that moved and was not ours" would let a restore's own scroll take over itself. D4 now scopes the takeover to wheel and touch and says so; CHECKLIST. |
| 7 | A wheel spent inside a nested card scroller, or a horizontal swipe, takes over though the transcript did not move. | DeepSeek F6, Opus 1 | True. | Not changed, for the reason in row 6 (it needs the transcript's own movement told apart from ours); CHECKLIST. |
| 8 | The restore's "under way" has two owners (the decision state and ChatView's pending position). | DeepSeek F7, Opus 7 | True; the cause of row 1. | Narrowed: the pending position now follows the decision in one place (`dispatchViewport`). Folding it into the decision state is left for a later refactor. |
| 9 | The failed-jump test never ran the jump's read: a setup prefetch did the asking. | Opus F1 | True. | Fixed: the window gains newer only after the reader is placed mid-window, the test asserts `holding` before the press and the reader's place at the failure. |
| 10 | `AFTER_PAGE[want === "older" ? "older" : "newer"]` hides a mapping. | Opus 7, DeepSeek 7 | True (style). | Fixed: `LANDS_AS` names it. |
| 11 | Every touchmove builds the decision's input, which reads layout. | Opus 1 | True (cost). | Fixed: the takeover runs only when `readerCanTakeOver`. |
| 12 | Two tests do not discriminate on 54a9b5d6's predecessor ("asks nothing once the view is gone", "ends with the session"). | DeepSeek 6 | True. | Kept as coverage; each kills a named mutant. |
| 13 | A restore with `onLoadMore` undefined stays `restoring` with no producer. | Opus 3, DeepSeek 3 | True in principle, unreachable (the app always wires it). | Not changed. |
