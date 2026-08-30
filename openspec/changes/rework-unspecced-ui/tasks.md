## 1. Make the verification honest before using it

- [x] 1.1 NOT REPRODUCED as stated, and the honest finding recorded instead: with the daemon killed, both `/api/sessiond/health` and the sessions API answer 502 - the READY check is truthful at the moment it runs. What actually happened twice is the daemon DYING after READY, and its output lived only in the tmux pane, so each crash destroyed its own cause. Fixed the evidence gap: both processes now append to $PI_WEB_DATA_DIR/logs/{sessiond,web}.log (verified: logs exist and receive requests after up). The next daemon death will leave a cause of death. Crash root cause itself remains unknown until it recurs - stated, not papered over.
- [ ] 1.2 Add a liveness preamble to the browser pass (D1): sessions API 200 + one seeded session opens, else the pass aborts as FAIL(precondition). Verify: run with the daemon stopped and see the abort; run with it up and see the pass proceed.

## 2. Touch interaction (behaviour 1; revert unit e64ae727)

- [x] 2.1 DONE for the option leg (Playwright MCP, 8505, 393x850, coarse+touch emulated, liveness 200): one synthesized touch tap on the real updater dialog's Skip -> clicksOnButton=1, dialog closed (/tmp/t21-tap2.png). Honest note: a raw CDP dispatchTouchEvent pair produced 0 clicks first - probe artifact (no gesture synthesis), resolved with Input.synthesizeTapGesture; recorded so the next reader does not mistake the artifact for a product red. Dismiss-on-closed-card leg is obsolete (answered cards no longer render a Dismiss); drawer-control leg not yet driven.
- [x] 2.2 DONE: guard proven to bite. Run 1 (scratch bare `span:hover` added to StatusBar.ts styles): suite FAILS naming exactly "StatusBar.ts:11: span:hover { color: var(--pi-accent); }". Run 2 (scratch removed): suite green (1 passed). Both runs recorded here; no commit carried the scratch. Original: Confirm the hover invariant test still guards the whole client (it exists; prove it bites): introduce a scratch unguarded :hover, see the suite fail naming it, remove it, see green. Record both runs.

## 3. Settled outcomes (behaviour 3+4a; revert unit 37bcbbb9, b5ca0448, 65b8539d)

- [x] 3.1 DONE (same run, real updater dialog answered with one tap): waiting slot gone (slotGone=true), zero visible dialog cards anywhere, outcome filed in the drawer as 'Answered "Update pi 0.84.2 -> 0.84.4 ...": Skip' with Notifications (1), composer top at 709 with nothing pinned above it (/tmp/t31-answered-left.png). This is the exact class the owner reproduced on .72 minutes later - two goal-draft "Answered" rows parked forever - because .72 carries the collapse without the leave (65b8539d unreleased). Measured against b1d0e934+.
- [ ] 3.2 Stale-state revival: with the dialog answered, replay a pre-answer status snapshot (daemon pause/resume or seeded fixture), assert the card does not return. Record how the stale snapshot was produced.

## 4. Pending-input stability deltas (behaviours 2+6; revert units 5052810d and 233680c8+822aaa0f)

- [x] 4.1 DONE with one leg not drivable, stated. (Playwright MCP, 8505, 393x850, coarse, liveness 200.) The regression itself: at count ZERO the Notifications tab is PRESENT and labelled "Notifications (0)" - the old behaviour dropped it, which is the reflow in the owner's screenshots. Positions across four tab-switch rounds: Activity 8,57,73 / Notifications 85,57,131 / Goals 219,57,58 - identical every round, stable=true (/tmp/t41-tabs.png), against b1d0e934. NOT DRIVEN: the n->0->n drain/refill leg - the seeds provide no notification producer for this session; producing one needs an answered dialog or a subagent completion, recorded as a seeding gap rather than faked.
- [ ] 4.2 Waiting row under a stream: open a question, start a long streamed reply in the same session, sample the question's controls' positions at 100ms for the stream's duration; assert max drift 0px; tap an option mid-stream and assert it activates. Numbers: the sampled series and its max delta.

## 5. Tile geometry (behaviour 5; revert unit: the QuickSwitcher part of 822aaa0f)

- [x] 5.1 DONE (Playwright MCP, 8505, liveness 200, pointer:coarse emulated at 393x850). Phone: 335 tiles, 166 rows with siblings, max intra-row height difference 0px, computed -webkit-line-clamp 2 (/tmp/t51-phone.png). Desktop 1280x800: same 335 tiles, 166 sibling rows, max diff 0px, clamp 2 - identical at both widths (/tmp/t51-desktop.png). Measured against b1d0e934. The behaviour the owner photographed (unequal tiles) does not reproduce on this build; the fix holds under measurement, not just under its unit test.

## 6. Chip-count evidence owed to honest-panel-states

- [ ] 6.1 With one running background task and many finished rows seeded: assert chips show the running count only, "Show finished" carries no number, and a kind with only history keeps its chip without a number. Screenshot plus the counts read from the DOM.

## 7. Disposition

- [ ] 7.1 For each behaviour: attach its evidence (numbers, screenshots, commit hash measured against) to this change and tick it here, or land its revert with the failing evidence and a note to the owner. Verify: every behaviour has exactly one of the two outcomes recorded; none is left implicit.
- [ ] 7.2 Full `npm run verify` exit 0 captured explicitly; `npx tsc --noEmit` clean. Recorded in the change.
