# Tasks

## 1. Spec reconciliation

- [x] 1.1 Apply the five deltas to `openspec/specs/chat/` (warning-delivery,
      settled-outcomes, panel-load-honesty, pending-input-stability,
      state-consistency) with `openspec archive`, keeping the filed-only
      notification honesty and the contributed-only drawer contract.
      (Archive moved the change; the deltas were merged into the main specs
      by hand because archive skipped spec updates with incomplete tasks.)
- [x] 1.2 Grep the archived specs for residual "notification drawer",
      "drawer gains", "notification count" wording that presumes a built-in
      surface, and reconcile any straggler the same way.
      (Stragglers reconciled: warning-delivery purpose + session-scoped
      scenario, state-consistency count/content scenario, pending-input
      producer list.)
- [x] 1.3 Confirm the implementation needs no code change: the contributed-only
      drawer contract is already shipped (e12be019) and probed (10/10,
      scripts/probe-waved.mjs).

## 2. Guardrails

- [x] 2.1 Verify the pinned tests still match the archived specs
      (ChatView.drawerSections, ChatView.pluginPanels, probe-waved) and that
      no archived requirement demands a built-in drawer surface.
      (ChatView.drawerSections + ChatView.pluginPanels: 9 tests passed;
      probe-waved 10/10 recorded in the Wave D close-out.)
