# Review triage: batch 3 (754821b2)

Commits reviewed: `aa9f73b7` (viewport follow flag), `41588fd7` (scroll guard), `5f4abaef` (URL rewrites name their session), `37c96bbb` (a found session opens only on its machine), `040200ec` (B10 follow-up), `b7922304` (failed page reads, restore settles). Lanes: Opus (`batch3-opus.md`) and DeepSeek (`batch3-deepseek.md`), both reading the frozen worktree `/tmp/pw-batch3`, neither with a shell.

Verdicts: no P0 or P1 from either lane. Opus: OK on 41588fd7, 5f4abaef and 37c96bbb, OK with notes on the rest. DeepSeek: OK with notes on 41588fd7, 37c96bbb and b7922304, OK on the rest.

Both lanes judged FALSE, after reading every caller, the regression risks the brief named: the scope check never drops a session the reader asked for (every follow captures the machine after the intent's move settled), and the address check never lags the app's own write (`writeRouteUrl` is synchronous).

Every row below was checked against the source. "Fixed" names the follow-up commit and its evidence.

| # | Finding | Lanes | Verdict | Outcome |
|---|---------|-------|---------|---------|
| 1 | A restore near an older window's end pins the reader (`updatePinnedToBottomAfterRestore` uses 48 px without `hasNewer`), so the next newer page carries them down: B13 through a writer `followsAfterScroll` does not cover. | Opus F1 | True by reading. | Fixed: the restore's flag respects `hasNewer` for a restored, bottom or skipped spot, and the settled state follows the flag. Test fails on b7922304. |
| 2 | A jump whose read failed resumes `following` at an older window's end, where no scroll loads; the hold's end asks nothing. DeepSeek adds: the pending jump then let the next live frame write `awaitingPage` by hand with no read out, a state nothing can start a read from. | Opus F2, DeepSeek F2 | True. | Fixed: a failed jump resumes `holding` when newer remains; the jump's walk moved into the decision (a newest page that lands short asks again through `load-newest-page`), and `jumpToNewestPending` and `continueJumpToNewest` are deleted. |
| 3 | One failed read of a restore's spot page lands the reader at the newest and drops the remembered place within a frame; it also fires after the reader scrolled away. | Opus F3, DeepSeek F4 (both "owner's call") | True. Decided by the owner's standing rule "absence is not negation": a failed read is unknown, not "the spot is gone". | Fixed: a spot page that waits out a hold or is on its way keeps `restoring`, and the hold's end goes on restoring; only an older end that is not there lands at the newest. A reader's wheel or touch during a restore takes over (D4's `reader scrolls during restore` edge, unbuilt until now), so a late restore cannot move them. |
| 4 | Every restore page after the first went around the decision (`handleScrollRestoreResult`'s direct `requestLoadMore`), and after the first page the state was `holding`, so a failure there was never held: the restore asked again every frame. | Opus F4 (DeepSeek judged the direct call guarded; it is guarded only on the first page) | True. | Fixed: the restore executes the decided action, and stays `restoring` across its pages. Test fails on b7922304. |
| 5 | The hold compared `Date.now()` with a `setTimeout` deadline; a wall clock that steps back leaves a hold whose timer already ran. | Opus F5 (DeepSeek judged it safe given strict `<`) | True for a clock that steps back. | Fixed: the hold is a state (`open`, `held`, `released`) its own timer releases; the decision no longer reads a clock. |
| 6 | D4 says a downward scroll within 48 px reaches the bottom; the `holding --> following` edge used 2 px. | Opus F6 | True. | Fixed: the edge uses the 48 px rule (`isNearScrollBottom`). |
| 7 | `docs/plugins.md` and `docs/plugins.html` disagree on what is refused (a title, or a title or message). | Opus F7 | True. | Fixed. |
| 8 | The guard's self-check names only bare `./X` imports, so dropping `(?:\.js)?` again would lose `uiIcons` with the guard green. | DeepSeek F1 | True. | Fixed: `uiIcons.ts` is named. |
| 9 | A skipped restore (zero-height scroller) set `holding` while the follow flag stayed pinned. | DeepSeek F3 | True. | Fixed with row 1: the state follows the flag. The spot itself is still not restored once the chat gets height (pre-existing; CHECKLIST). |
| 10 | A held end refuses the reader's own fresh scroll for the whole hold, while D4's text said only non-intent waits. | DeepSeek F5 | True as a doc/code mismatch. | The code stays: the update that follows a failure cannot tell the reader's scroll from its own re-evaluation, which is what repeated 47 reads a second. D4 now says only the jump asks through the hold; the first hold is 1 s. |
| 11 | No test covered `openPages` on a session change, the timer on disconnect, or the jump walk. | DeepSeek F6 | True. | Fixed: one ChatView test each. |
| 12 | The refusal for the new machine (37c96bbb) is silent. | DeepSeek note | True; the changeset records it as intended. | Not changed. |

## Found while checking row 2

Pressed mid-window in an older window, the back-to-newest key asked nothing and moved nothing. Its newest read went through `startNewerPage`, which applies the forward end's prefetch distance (1.5 screens), so the decision moved to `awaitingPage` with no read out. `probe-jump-far.mjs` on b7922304: 0 reads, `fromBottom` unchanged at 56,856 px, 3/5. Pre-existing since the viewport decision table (f78dcdfb). Fixed in the same follow-up: `startNewestPage` asks wherever the reader is, through the `load-newest-page` executor, and a failed start is reported as `pageFailed`.

## Harness note

`ChatView.pageRetry.test.ts` gives the scroller a clamped `scrollTop` that fires a scroll event on the next frame, and its scrolls wheel first, as a reader's do. Several failures while writing the follow-up were the harness, not the code (a scroll event that never fired; a pinned bottom that a frame-time writer restored before an upward scroll), and each was settled by tracing in a scratch test before the assertion was changed. Multi-step scroll flows are proved by the 8505 probes, not by this harness.
