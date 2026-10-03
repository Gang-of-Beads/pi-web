# Review triage: batch 6 (bbe5adc9)

Commit reviewed: `e5cdaba3` (a jump's debt drops on any reader scroll, only a failed jump unpins, a session switch settles nothing). Lanes: Opus (`batch6-opus.md`) and DeepSeek (`batch6-deepseek.md`), both on the frozen worktree `/tmp/pw-batch6`, neither with a shell.

Verdicts: both "OK with notes". DeepSeek rated row 1 P1; Opus found the same as P2. Both judged the session-switch skip unable to strand state (the switch clears the marks, the hold and the spot, and `opened` replaces the state), and the spot's single owner complete.

| # | Finding | Lanes | Verdict | Outcome |
|---|---------|-------|---------|---------|
| 1 | Two writes that hold the reader's place (the image-load compensation and the render-time reading anchor) moved the transcript without resyncing `lastScrollTop`, so their scroll read as the reader's and dropped a failed jump's debt; every sibling writer resyncs. | DeepSeek F1 (P1), Opus | True. | Fixed: `holdThePlace` makes both writes and resyncs. The browser's own clamp on a dock or keyboard resize still drops the debt (safe direction); D4 says so. Test fails on e5cdaba3. |
| 2 | `owedAfter` treats any `resume: following` wait as a jump, so an unfilled following view's failed older read would unpin. | DeepSeek F2, Opus 6 | False in practice: a failed read resumes `holding` only with `hasNewer`, and a following window has newer only after a jump; otherwise it stays `following` and nothing unpins. The name over-claimed. | `jumped` renamed `owedTheNewest`. |
| 3 | The `restoreSettled` table did not assert the non-restoring state a frame can meet (`following`). | DeepSeek F3 | True. | Added. |
| 4 | No integration test drove the handler whose spot clears were deleted. | DeepSeek F4 | True. | Added: a restore found while its page is on its way ends and forgets the spot, through `handleScrollRestoreResult` (the reader at the bottom resumes `following`). |
| 5 | The `hasNewer` rescue's five-part condition. | Opus 6 | True (style). | Named: `waitRescuedByTheNewest` returns the awaited want. |
| 6 | "keeps the pin after a failed read that was not a jump" seeds a narrowly reachable state. | Opus 5 | True. | Kept: it guards the named mutant; the reachable route is row 2's. |
| 7 | A session switch while the scroller is unmeasured leaves the previous `awaitingPage` standing (`measured: false` answers idle). | Opus | True; older than these commits. | CHECKLIST. |
