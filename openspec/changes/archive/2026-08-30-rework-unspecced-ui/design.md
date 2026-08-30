## Context

See proposal.md - Why. Six behaviours are already on main and released; this
change owes them specs (written) and live evidence (owed). The verification
target is the 8505 stack driven by Playwright MCP at 393x850 with a coarse
pointer. One hazard is already known and must shape the procedure: the stack's
READY check has twice reported a dead session daemon as healthy, so no
verification below may begin from READY alone.

## Goals / Non-Goals

**Goals**

- Every one of the six behaviours either carries evidence from the owner's
  conditions or is fixed/reverted. No third state.
- Verification that cannot run reports FAIL loudly (precondition unmet), never
  silently passes - the owner's standing rule for verification scripts.

**Non-Goals**

- New behaviour, refactors, or opportunistic fixes encountered on the way.
  Anything found broken that is outside the six gets recorded as a finding for
  its own change, not patched here.

## Decisions

### D1 - Liveness is proven per run, not assumed from READY

Every browser pass starts by proving the daemon is actually serving: a
sessions API call must return 200 and a seeded session must open. The
stack-8505 READY line is treated as advisory only. Rejected: trusting READY,
which has already produced one false verification today and would have
produced more.

### D2 - Evidence is numbers first, screenshots second

Where the spec says "equal heights" or "unchanged position", the pass records
getBoundingClientRect values and their diffs; the screenshot illustrates, the
numbers decide. Rejected: screenshot-only evidence - a screenshot of a
393px-wide emulation cannot show a 2px drift or distinguish loaded from
still-loading.

### D3 - Coarse pointer is emulated for real

The pass runs with touch emulation so `pointer: coarse` media queries and
touch event dispatch actually take the touch paths, since the behaviours under
test (hover guard, tap activation) differ by input modality. A pass on a fine
pointer proves the wrong thing and counts as precondition-unmet FAIL.

### D4 - Reverting is a first-class outcome

Each behaviour's tasks name its revert unit (the commits to back out) up
front. If evidence shows a behaviour wrong, the revert lands with the failing
evidence attached, and the owner decides whether a redesign is wanted.
Rejected: fix-forward as the only path, which is how today's unspecced work
accumulated.

## Risks / Trade-offs

- **The seeded data cannot produce a state a spec demands** (e.g. no seeded
  session streams long enough to observe the waiting row) → extend the seeder
  in scripts/ as part of this change's tasks; test infrastructure is in scope,
  product code is not.
- **Playwright's emulation may not reproduce the phone behaviours faithfully**
  (double-tap-zoom timing already proved unreproducible in emulation once) →
  record "not reproduced in emulation" honestly where it happens; that leg then
  needs the owner's device, and the task says so instead of claiming green.
- **Evidence rot: the numbers are true today and stale tomorrow** → each
  evidence artefact records the commit hash it was measured against.

## Migration Plan

No deployment. Verification order: touch-interaction first (owner's most
reported pain), then settled-outcomes, then pending-input-stability deltas,
then tile-geometry, then the chip-count evidence owed to honest-panel-states.
Rollbacks are per-behaviour as decided by their evidence (D4).

## Open Questions

None.
