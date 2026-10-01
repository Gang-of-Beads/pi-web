# Review triage: P2 slice b part 2, the open session goes

Review run `2ad31dd5`, two lanes on the builtin `reviewer`:
- Opus 5.5: `review/p2b2-opus.md`;
- DeepSeek 4.1 max: `review/p2b2-deepseek.md`.

Both lanes: OK with notes, no P0 or P1. Every hunt item holds on the paths the product reaches. Every finding is marked below as fixed, not fixed with the reason, or judged not true.

Owner rulings implemented (2026-10-01):
- the session being read, deleted elsewhere, is reported as deleted, with the approved gone words;
- Restore goes in the composer slot of an archived session.

## Findings

| # | Lane | Finding | Verdict | What changed |
|---|---|---|---|---|
| DS-1 | DeepSeek P2 | `abortTreeNavigation` still turned the code into a notice, though the census lists it with the selected-session sites. The daemon change makes it reachable: cancelling a tree summary on a session deleted meanwhile now answers 404 with the code. | **True, fixed** | It reports through `failedFor`, and a test drives it. `closePendingStartDialog` stays a notice on purpose: a client pending row has a temporary id that the machine cannot locate. The census now says so. |
| DS-2 | DeepSeek P2 | The seam never wrote the URL. On a pick, `showView("chat")` wrote the previous session's id before `selectSession`, so a reload of the gone words opened another session. | **True, fixed** | `locateAnsweredGone` calls `updateUrl()` once the target is published (the precedent is `workspaceController`). The controller test asserts the URL names the picked row, and so does probe leg G3. |
| DS-3 | DeepSeek P2 | The loop guard survived an open that failed for another reason, so a later archive elsewhere read as gone. | **True, fixed** | A selection read that fails with anything but the code clears the guard. Test: locate finds the session elsewhere; its open fails with a 500; a later code asks the machine again (`locates: 2`). |
| Opus-2A | Opus P2 | The guard was armed when the locate was sent, not when a located session was opened. So a locate that got no answer, followed by a reopen that answered the code, went straight to gone. | **True, fixed** | The seam records only which id it asked about (`seamLocating`). The resolver's `open` arms the guard when it opens that id. Test: the first locate fails to reach the machine; the reopened session answers the code; the machine is asked again. |
| Opus-2B | Opus P2 | A stale call from before the relocation, same id but the old cwd, could hit the armed guard. | **Judged not reachable, recorded** | Neither lane found a producer in the product. The calls in question (`listModels`, `listThinkingLevels`, `loadEarlierMessages`) are issued from the selected session, and the relocated open replaces it. |
| Opus-1 | Opus P2 | With no selected workspace, the seam's notice-only fallback lost "Couldn't load this session.", which left an empty transcript under a live composer. | **True, fixed** | The selection read sends the code to the seam only when a workspace is selected. Otherwise it keeps the old `transcriptFailed` words. Test: a picked row answering the code with no workspace reads "Session not found" in the failed-load state. |
| Opus-3 | Opus P2 | A double tap on Restore: the second restore answers the code and flashes the asking panel. | **True, fixed** | The strip takes a `restoring` flag, and the button is disabled while a restore is on its way (`PiWebApp.restoreFromComposerSlot`). A happy-dom test checks the second tap is refused. |
| Opus-4 | Opus P2 | There were two stacked JSDoc blocks above `abort`, and a `//` narrative at the top of a test. | **True, fixed** | The blocks are merged, and the test comment is a docstring. |
| DS notes | DeepSeek | `PromptEditor.disabled` is now always false for its only consumer, and the composer's handlers are no-ops while the strip stands. | **True, report only** | Nothing is lost: the draft and attachments are kept per session. Retiring the dead branches is a later cleanup. Sends remain an owner question. |

## Found live on 8505 (probe-open-session-gone.mjs)

- **The live probe session names the flaky probe provider**, whose injected delays held the page's reads of its copies for 18–25 s. The later reads then queued behind them on the six HTTP/1.1 connections. Measured directly with curl, the daemon answers every read of a deleted session with the code in 73–110 ms, and a cold open takes 0.93 s. The probe now copies a small seed session with a normal provider.
- **`context.setOffline` does not close an open WebSocket in Chromium**, so it caused no reconnect and no read. The daemon pushes no deletion (heads are B28), so the page learns only on its next read. The G2 leg now drives the reader leaving the tab and coming back: a real `visibilitychange` through the app's own resume refresh, which calls `refreshSelectedSession`.
- **The first G2 trace showed a status read that overlapped a Stop of the runtime it was opening, answering 504 after 25 s.** It was not separated from the flaky provider's delay. It is recorded on the checklist to investigate on its own.

## Mutation checks

- **Kill confirmed:** every seam, both guard transitions, the URL write, the tree-cancel route, the no-workspace fallback, the daemon's abort and stop locate, the pick continuation, the `already-located` route, and the strip's disabled state are each killed by at least one test.
- **Hang instead of a failure:** a guard that is never armed turned a test into an endless locate → open → locate cycle. A loop made only of promise callbacks starves the runner's timeout, so the "found" answers in those tests are now capped (`foundAtMost`), and a broken guard fails on its locate count instead of hanging CI.
