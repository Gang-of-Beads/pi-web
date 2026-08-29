# Tasks — steady-surface-and-visible-actions

Verification conditions for every task: `npm run typecheck` and `npm run lint` clean, and any
task touching behaviour is proven in the owner's device conditions — the 8505 test stack
(`scripts/stack-8505.sh up`), a real browser at **393×850 with a coarse pointer** — not only in
unit tests. Each task is one commit; nothing is committed while `npm run verify` is red.

## 0. Already landed — evidence recorded, do not redo

- [x] 0.1 Hold the waiting question outside the scrolling transcript in its own layout row (`renderWaitingForYou` → `.waiting-slot`); settled dialogs stay in the transcript where they happened. — **Done, commit `233680c8`.** Evidence: ChatView renders the slot outside `.chat`; tests `ChatView.askUser.test.ts`, `ChatView.extensionDialogs.test.ts` assert the new placement.
- [x] 0.2 Retire the open-card alignment scroll and its press-deferred replay together with the tests that guarded them. — **Done, commit `822aaa0f`.** Evidence: `ChatView.pressHoldsScroll.test.ts` alignment describe removed; press-catch-up and drawer-stillness guards untouched and green. (Residual dead fields are task 1.1.)
- [x] 0.3 Let an answered dialog leave without parking a card, decouple suppression from the Dismiss button, and count active rows in the activity chips. — **Done, commits `37bcbbb9`, `65b8539d`.** Evidence: `sessionController.extensionDialogs.test.ts` asserts `dismissedDialogIds` suppression; `ChatView.subagents.test.ts` asserts chips count running rows.

## 1. Clear the ground

- [ ] 1.1 Delete the unreachable alignment machinery in ChatView: `scrollToOpenAsk`, `scrollToOpenDialog`, `alignOpenAskToTop`, `alignOpenDialogToTop`, `deferredOpenAlign`, their requestAnimationFrame frame fields, the cancellation branches, and the deferred-replay block. Verify: `rg -n "scrollToOpenAsk|scrollToOpenDialog|alignOpenAskToTop|alignOpenDialogToTop|deferredOpenAlign" src/` returns no matches; `npm run verify` green. Evidence: grep output (empty) + commit.

## 2. Measurement harness first (red before any fix)

- [ ] 2.1 Write `scripts/probe-waiting-stability.mjs` (convention of `probe-dialog-flow-hit-testing.mjs`): on the 8505 stack at **393×850, coarse pointer**, open a session with a pending dialog, start a streamed reply, and sample at 100 ms — bounding rects of the waiting controls, composer top edge, dock and strip heights, and `elementFromPoint` at touchstart vs the click target. The probe FAILS if preconditions are unmet (no question rendered, no stream, wrong viewport). Verify: probe runs and produces a **RED baseline** — the owner's jitter reproduced as numbers (max displacement > 0 px below the transcript; waiting-slot displacement expected already 0 from 0.1). Evidence: probe output pasted into the change notes + script committed.

## 3. Steady region below the transcript (spec: chat/pending-input-stability)

- [ ] 3.1 Reserve the activity dock's row whenever the selected session is live; clip its label to one line (ellipsis) so text and timer growth cannot change its height. Verify: unit test asserting the reserved row and one-line clipping; probe at 393×850 shows dock height delta **0 px** across a streamed reply. Evidence: test + probe numbers.
- [ ] 3.2 Reserve the queued strip's row while a stream is active, so appearing/clearing cannot move the composer. Verify: unit test for the empty-but-present state; probe shows composer top delta **0 px** across strip appear and clear. Evidence: test + probe numbers.
- [ ] 3.3 Make the waiting-slot's departure wait for `pointerup`/`pointercancel` when a pointer is down (through ChatView's existing press tracking). Verify: unit test — pointerdown → outcome settles → slot still present → pointerup → slot gone; probe tap test: `elementFromPoint` at touchstart equals the click target on a dialog option, single tap activates. Evidence: test + probe numbers.
- [ ] 3.4 Re-run the probe after 3.1–3.3 and record the GREEN numbers (all sampled deltas 0 px; tap activates first touch). Evidence: full probe output in the change notes; this is the acceptance gate for the pending-input-stability spec.

## 4. Commands are visible work (spec: chat/action-acknowledgment)

- [ ] 4.1 Add the client `CommandLedger` per design D2 and render its entries as gold transcript rows with states queued → running → ok/failed, for typed slash/shell commands and goal-panel commands alike. Verify: unit tests for the state machine (including send-parked and failure paths); live on 8505 at **393×850**: typing `/goal-pause` shows a row immediately with a visible result. Evidence: tests + observed behaviour.
- [ ] 4.2 State the wait: while the session is streaming, the row reads "waiting for the current reply to finish" and flips to running when the command proceeds. Verify: unit test with a fake in-flight turn; live: press goal **Resume** during a streamed reply — the press is visibly acknowledged, the row walks queued → running, the goal panel then shows the goal active. Evidence: tests + observed behaviour.
- [ ] 4.3 Reconcile ledger rows with the server's own record (retire on match; never duplicate). Verify: unit test for the retire-on-echo path; live: a command appears exactly once in the transcript. Evidence: test + observed behaviour.
- [ ] 4.4 Goal panel buttons acknowledge the press itself: pressed state at once, disabled while in flight (no second copy from a double press), failure surfaced in the row, panel refreshed only after the command settles. Verify: coarse-pointer **393×850** live check — single tap Resume activates once, no double-tap needed; during a stream the button never reads as dead. Evidence: observed behaviour + screenshot.

## 5. A withdrawn question states why (spec: chat/action-acknowledgment)

- [ ] 5.1 Server: set the additive `cause` (`user-message` | `withdrawn` | `timeout`) on ask outcomes in the void paths, including `voidOpenAskForUserMessage`. Verify: server unit tests asserting the cause per path; `npm run typecheck` clean. Evidence: tests + commit.
- [ ] 5.2 Client: render the cause — "You sent a message instead of answering", "Withdrawn before an answer", and plain "Cancelled" when `cause` is absent. Verify: unit tests per cause including the absent-field fallback; live at **393×850**: send a message while a question is open → the card says the message replaced it, not a bare "Cancelled". Evidence: tests + screenshot.

## 6. Gate

- [ ] 6.1 Full `npm run verify` (0 failures) + `npx tsc --noEmit` (0 errors) + probe suite green at 393×850 with numbers recorded in the change notes. Evidence: command outputs + probe numbers; on green, the change is ready for archive.
