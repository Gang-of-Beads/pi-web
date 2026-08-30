## Why

Six pieces of UI behaviour were changed and released without a spec, without
review, and without ever being driven in a real browser. The owner's rule is
explicit: work that bypassed the process is rework, not a fait accompli - it
either passes verification now or it is overturned.

The pieces, all already on the owner's phone in v1.202608.72 or on main since:

1. Every `:hover` rule moved behind `@media (hover: hover)` with an invariant
   test (e64ae727) - shipped as the fix for "one tap only tints the button".
2. The drawer tab strip keeps its membership when a count reaches zero
   (5052810d).
3. An answered extension dialog collapses instead of demanding a Dismiss tap
   (37bcbbb9, b5ca0448) - this one shipped broken: the collapsed row had no
   exit and sat above the composer until a later commit (65b8539d) let it
   leave. The breakage reached the owner's phone before the fix existed.
4. Activity chips count only running work and "Show finished" dropped its
   number (65b8539d).
5. QuickSwitcher tiles: equal heights within a row, the title clamped to two
   lines at every width (in 822aaa0f).
6. The pending ask/dialog moved out of the transcript scroller into its own
   layout row, and the open-card alignment scroll was deleted with its tests
   (233680c8, 822aaa0f) - specced after the fact in steady-surface, coded
   before the spec existed.

The invariant violated is procedural but it is the one the owner has paid the
most for today: **nothing ships without a spec the owner could have rejected
and evidence from the conditions he uses** - a real browser, 393x850, coarse
pointer. Item 3 is the proof: the one piece that shipped mid-process broke on
his phone in exactly the way a browser pass would have caught.

## What Changes

- Each of the six pieces gets its behaviour stated as spec deltas under the
  capability it belongs to, written so the owner can reject them on paper.
- Each is then verified in the owner's conditions against the 8505 stack with
  Playwright MCP. Passing pieces keep their commits and gain their evidence;
  failing pieces are fixed or reverted - reverting is an acceptable outcome
  and must not be treated as failure.
- No new behaviour is introduced. This change legalises or overturns what
  already happened; it adds nothing.

## Capabilities

### New Capabilities

- `chat/touch-interaction`: what a single tap does on a coarse pointer, and
  what hover may never do there (covers 1).
- `chat/settled-outcomes`: what an answered or dismissed surface leaves behind
  and where its record lives (covers 3, and the answered-dialog half of 4).
- `navigation/tile-geometry`: the shared geometry contract for tiled lists -
  row height equality, title clamps, and what may vary by viewport (covers 5).

### Modified Capabilities

- `chat/pending-input-stability`: absorb 2 and 6 as requirements with their
  existing wording tightened to match what was actually built - the tab strip
  clause and the waiting-row clause exist there already; they must now carry
  the live-evidence scenarios this rework demands.

### Note on 4 (activity chip counts)

The counting rule belongs to `honest-panel-states` (a chip describes the
present, not history) and is already specced there; this change only owes it
the browser evidence.

## Impact

- No planned source changes unless a verification fails.
- `openspec/specs/` gains three capabilities; `chat/pending-input-stability`
  gains scenarios.
- The evidence artefacts (screenshots, measured numbers) attach to this change.

## Non-goals

- Re-litigating decisions the owner has since made explicitly (auto-collapse
  was his choice; the tab strip fix was his instruction). The rework verifies
  the implementations, not the decisions.
- The stack-8505 READY check that reported a dead daemon as healthy. Real, and
  owed its own change - test infrastructure, not UI behaviour.
