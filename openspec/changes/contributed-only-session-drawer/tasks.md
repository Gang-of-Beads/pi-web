# Tasks

## 1. Spec reconciliation

- [ ] 1.1 Apply the five deltas to `openspec/specs/chat/` (warning-delivery,
      settled-outcomes, panel-load-honesty, pending-input-stability,
      state-consistency) with `openspec archive`, keeping the filed-only
      notification honesty and the contributed-only drawer contract.
- [ ] 1.2 Grep the archived specs for residual "notification drawer",
      "drawer gains", "notification count" wording that presumes a built-in
      surface, and reconcile any straggler the same way.
- [ ] 1.3 Confirm the implementation needs no code change: the contributed-only
      drawer contract is already shipped (e12be019) and probed (10/10,
      scripts/probe-waved.mjs).

## 2. Guardrails

- [ ] 2.1 Verify the pinned tests still match the archived specs
      (ChatView.drawerSections, ChatView.pluginPanels, probe-waved) and that
      no archived requirement demands a built-in drawer surface.
