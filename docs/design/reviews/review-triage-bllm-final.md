# Final bllm review triage — wave 98fd0aad..d5dea983

Two anonymous lanes (botim-bllm glm-5.3-flash:max, qwen3.8-flash-next:max)
reviewed the landscape/empty-chat remap commit, the bllm triage fixes commit,
and the plugin-matrix probe. Raw lane reports live in the subagent artifacts
directory under runs `b5e6476a` (glm, history/state machines) and `ea9c7276`
(qwen, composer/data scope). Verification at triage time: targeted vitest
green, tsc clean, matrix probe re-run after fixes.

## glm lane

1. **P1 swallowed back-to-list tap** — `backToSettingsList` popped a stale
   modal placeholder frame left by a machine dialog closed via its own
   cancel; the first tap did nothing. **Fixed**: the replace branch is also
   taken when a placeholder frame is outstanding
   (`placeholderFrameOutstanding()` in historyWrites.ts; PiWebApp
   `backToSettingsList`), and unit tests pin the push/replace/placeholder
   transitions in historyWrites.test.ts.
2. **P1 edge control keyed to width only** — the navigation edge control hid
   under `max-width: 760px` while the shell keys its phone layout to
   `(pointer: coarse), (max-width: 760px)`, so a landscape phone wore a stray
   18px strip. **Fixed**: AppPanelEdgeControl hides its whole host under the
   same compound query (covers the workspace control on coarse tablets too).
3. **P2 "Close panel" dead with no session on mobile** — the toggle is a
   no-op when the panel is the whole view. **Fixed honestly**: the toggle is
   hidden instead (`panelToggleHidden` on AppContextBar) rather than left as
   a mislabeled dead control.
4. **P2 boot deep link back-to-list replace then back reopens the section** —
   **judged by-design** (history-faithful; the docstring owns the tradeoff).
5. **P2 settings state machine untested** — **fixed** for the wave's own
   mechanism: historyWrites tests cover forcePush, the placeholder yield,
   and frame consumption.
6. **Out-of-lane observation: machine dialog behind the settings sheet** —
   confirmed by a live 8505 probe (state open, full-viewport rect, sheet
   painted on top; both layers at z 50, sheet later in DOM). **Fixed**: the
   machine dialog renders after the settings dialog, using the registry's
   documented document-order paint tiebreak; re-probed visible above the
   sheet.

## qwen lane

1. **P1 attachment capture crosses sessions** — the async capture resolved
   into whatever session was current, re-entering after the willUpdate clear;
   the failed-send restore had the same hole. **Fixed**: both async paths
   capture a machine+session scope key before the await and drop the apply
   when it no longer matches; tests cover switch-during-capture and
   restore-after-switch (the unchanged-session restore stays covered).
2. **P1 "Select visible" selected invisible rows** — the bulk actions were
   fed the unfiltered row set while rendered rows went through search filter
   and subtree hiding; the archived toolbar already used the filtered set.
   **Fixed**: the current scope's selection entry, toolbar, and start
   auto-select all receive the rendered set; tests drive a real search
   through the input.
3. **P2 collapsed subtree during selection contradicted its own comment** —
   **fixed to match the stated design**: selection mode shows the tree flat
   (rows not removed) and the inert toggle is visible but inert, so "Select
   visible" and the visible rows agree.
4. **P2 coarse subtree toggle overlapped row text by 4px** — **fixed**: the
   coarse reserved gutter grew to 44px so the 36px-wide toggle clears the
   first glyph.
5. **P1 (tooling) probe PANEL_CONTENT passed empty** — **fixed**: the
   matrix asserts the selected tab (`aria-pressed="true"` on the label's tab)
   plus non-trivial `.panel-content` text, so a missed tap or a chrome-only
   render fails loudly.
6. **P2 (tooling) voice/goals assertions under-asserted** — **fixed**: the
   composer record requires the dictate slot's presence and the goals body
   record requires the exact panel id matching the tab that was clicked.

## Judged not true / not fixed

- glm's coarse-tablet workspace-control remark was folded into fix 2 (the
  compound query hides both sides whenever the shell has no panel columns).
- The heading session count showing workspace totals while rows are filtered
  stays as-is: the heading states workspace size and the archived section
  prints its own count.
