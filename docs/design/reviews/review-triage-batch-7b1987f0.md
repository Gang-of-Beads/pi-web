# Review triage: batch 5 (7b1987f0)

Commit reviewed: `244b59b4` (the remembered spot belongs to the restore, a failed jump is owed, arrivals come from the read). Lanes: Opus (`batch5-opus.md`) and DeepSeek (`batch5-deepseek.md`), both on the frozen worktree `/tmp/pw-batch5`, neither with a shell.

Verdicts: both "OK with notes", no P0 or P1. Both lanes judged the arrival rule sound for the real producers (each page read writes its messages and turns the loading mark off with no `await` between, and a landed page always changes the `messages` reference), and the spot forgotten on every exit from a restore.

| # | Finding | Lanes | Verdict | Outcome |
|---|---------|-------|---------|---------|
| 1 | The owed jump survives a key or scrollbar scroll during the hold, so the hold's end carries the reader to the newest after they went elsewhere. | Opus F1, DeepSeek 3 | True. | Fixed: any scroll that moved the transcript and was not a follow scroll drops the debt (`updatePinnedToBottomFromScroll`). A programmatic write that moves it drops the debt too, which errs toward not moving the reader; it does not take over a restore, whose own writes would end it. Test fails on 244b59b4. |
| 2 | `unpinWhenReading` unpinned after any failed read ending in `holding`, so a following reader on an unfilled view stopped following growth. | Opus F2, DeepSeek 2 | True. | Fixed: only a jump's failure unpins. Test fails on 244b59b4. |
| 3 | A session switch settled the previous session's wait against the new session (the select patch turns the loading mark off with new messages), and could ask the new session's newest page. | Opus F3 | True; pre-existing, widened by 244b59b4. | Fixed: a session switch settles nothing. Test fails on 244b59b4. |
| 4 | The `hasNewer` arrival branch is a second producer: the window reaching its newest end while a read was out counted as that read's arrival, and the real arrival was then swallowed. | DeepSeek 1 | True. | Fixed: it rescues a wait only when no read is out (a read the host refused) and never across a session switch. Test fails on 244b59b4. |
| 5 | The spot clears in `handleScrollRestoreResult` are redundant. | Opus F4 | True except one edge they hid: a spot found while its page was on its way did not leave `restoring`, and once the page landed the restore stood with nothing to continue it. | Fixed: `restoreSettled` ends an in-flight restore (the page lands as the reader's), and the clears are deleted; the spot has one owner. |
| 6 | D4 said a wheel inside a nested card scroller does not take over; it bubbles to the transcript's `@wheel` and does. | DeepSeek 4 | True. | D4 corrected; CHECKLIST keeps it open. |
| 7 | The successful jump's walk lost its ChatView test in the batch-4 rewrite. | DeepSeek 5 | True: the rewrite's slice covered the block between the two failed-jump describes. | Restored ("the back-to-newest key (D4)"). |
| 8 | One batch-4 test ("does not ask for the newest at the hold's end once the reader scrolled away") passes on the base. | Opus 5, DeepSeek 6 | True. | Kept as the guard of a named mutant. |
| 9 | The `AFTER_PAGE` docstring sat on `LANDS_AS`; `onPageArrived` spelled a second mapping inline; `settlePageRead` took an unnamed boolean. | Opus F5, DeepSeek 7 | True (style). | Fixed: `LANDS_AS` and `FOLLOWED_LANDS_AS` are tables above the docstring; `settlePageRead("landed" \| "failed")`. |
| 10 | An unfilled following view loading older (`resume: following`) also walks to the newest when `hasNewer`. | Opus 4, DeepSeek 4 | True; judged right (a following reader's intent is the newest). | Not changed. |
| 11 | `pageArrived`'s `want` payload is never read by the handler. | DeepSeek 7 | True. | Not changed; the payload names the read in tests and logs. |
