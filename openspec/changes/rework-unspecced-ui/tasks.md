## 1. Make the verification honest before using it

- [x] 1.1 NOT REPRODUCED as stated, and the honest finding recorded instead: with the daemon killed, both `/api/sessiond/health` and the sessions API answer 502 - the READY check is truthful at the moment it runs. What actually happened twice is the daemon DYING after READY, and its output lived only in the tmux pane, so each crash destroyed its own cause. Fixed the evidence gap: both processes now append to $PI_WEB_DATA_DIR/logs/{sessiond,web}.log (verified: logs exist and receive requests after up). The next daemon death will leave a cause of death. Crash root cause itself remains unknown until it recurs - stated, not papered over.
- [ ] 1.2 Add a liveness preamble to the browser pass (D1): sessions API 200 + one seeded session opens, else the pass aborts as FAIL(precondition). Verify: run with the daemon stopped and see the abort; run with it up and see the pass proceed.

## 2. Touch interaction (behaviour 1; revert unit e64ae727)

- [ ] 2.1 Playwright MCP, 8505, 393x850, touch emulation on: open a seeded session with a pending dialog, tap an option once, assert activation on first tap (answer recorded server-side), repeat for Dismiss on a closed card and one drawer control. Numbers: tap count to activation for each. Screenshots before/after. FAIL if touch emulation is not active.
- [ ] 2.2 Confirm the hover invariant test still guards the whole client (it exists; prove it bites): introduce a scratch unguarded :hover, see the suite fail naming it, remove it, see green. Record both runs.

## 3. Settled outcomes (behaviour 3+4a; revert unit 37bcbbb9, b5ca0448, 65b8539d)

- [ ] 3.1 Playwright MCP, same conditions: answer a seeded extension dialog; assert no further tap is needed, the waiting area releases its space, the outcome row appears in the notification drawer, and nothing remains fixed above the composer after the answer. Numbers: bounding boxes of the waiting area before/after. Screenshots.
- [ ] 3.2 Stale-state revival: with the dialog answered, replay a pre-answer status snapshot (daemon pause/resume or seeded fixture), assert the card does not return. Record how the stale snapshot was produced.

## 4. Pending-input stability deltas (behaviours 2+6; revert units 5052810d and 233680c8+822aaa0f)

- [ ] 4.1 Tab strip under observation: drive notifications from n to 0 and back while the drawer is open; record tab positions each step; assert zero movement. Numbers: x/y of each tab per step.
- [ ] 4.2 Waiting row under a stream: open a question, start a long streamed reply in the same session, sample the question's controls' positions at 100ms for the stream's duration; assert max drift 0px; tap an option mid-stream and assert it activates. Numbers: the sampled series and its max delta.

## 5. Tile geometry (behaviour 5; revert unit: the QuickSwitcher part of 822aaa0f)

- [x] 5.1 DONE (Playwright MCP, 8505, liveness 200, pointer:coarse emulated at 393x850). Phone: 335 tiles, 166 rows with siblings, max intra-row height difference 0px, computed -webkit-line-clamp 2 (/tmp/t51-phone.png). Desktop 1280x800: same 335 tiles, 166 sibling rows, max diff 0px, clamp 2 - identical at both widths (/tmp/t51-desktop.png). Measured against b1d0e934. The behaviour the owner photographed (unequal tiles) does not reproduce on this build; the fix holds under measurement, not just under its unit test.

## 6. Chip-count evidence owed to honest-panel-states

- [ ] 6.1 With one running background task and many finished rows seeded: assert chips show the running count only, "Show finished" carries no number, and a kind with only history keeps its chip without a number. Screenshot plus the counts read from the DOM.

## 7. Disposition

- [ ] 7.1 For each behaviour: attach its evidence (numbers, screenshots, commit hash measured against) to this change and tick it here, or land its revert with the failing evidence and a note to the owner. Verify: every behaviour has exactly one of the two outcomes recorded; none is left implicit.
- [ ] 7.2 Full `npm run verify` exit 0 captured explicitly; `npx tsc --noEmit` clean. Recorded in the change.
