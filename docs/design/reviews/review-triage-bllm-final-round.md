# Final bllm review round — triage and adjudication

Three final lanes (glm-5.3-flash ×2 with split focus, qwen3.8-flash-next full pass) reviewed
the wave at HEAD d5dea983 (54e09832, 73845da9, 98fd0aad, 2d475388, 8b1d3dc4). Every lane
verdict was "OK with notes". Each finding below was re-adjudicated against the live source
before action; two lane claims did not survive that re-read. Lane outputs:
`/tmp/final-lane1-shell.md`, `/tmp/final-lane2-chat.md`, `/tmp/final-lane3-cross.md`.

## Fixed

### F1 (P1, shell lane 1) — panel edge controls leak onto coarse viewports wider than 760px
`AppPanelEdgeControl.ts` hid the navigation-side control under a width-only
`@media (max-width: 760px)` while the shell keys its phone layout to
`(pointer: coarse), (max-width: 760px)`. A landscape phone or iPad (coarse, wide) kept a
grey divider strip with a collapse pill that toggles an already-hidden `aside`. The hide
now uses the same compound query and hides `:host` for both sides.
*Fix in the working tree alongside the placeholder guard below.*

### F2 (P1, chat lane 1) — async attachment capture lands in the session the user switched to
`addAttachmentFiles` awaited `capturePromptAttachments` and then appended into whatever
composer was current; a session switch inside the read window delivered session A's image
into session B. The capture and the send-failure restore both capture
`machineSessionKey(...)` before the await and drop the late result when the key changed,
mirroring the outbox guard in `flushPendingPrompts`.
*Fix landed in the working tree (scope keys at capture, post-await re-check, guarded
failure restore).*

### F3 (P2, shell lane 1) — a modal placeholder frame swallowed the settings back press
`backToSettingsList` trusted `settingsListFramePushed` alone; a modal layer closed by
cancel leaves its placeholder frame on the stack, so `history.back()` consumed the stray
frame and the tap did nothing. The back now also requires `!placeholderFrameOutstanding()`
(newly exported), falling back to the replace path; `writeRouteUrl` keeps
`forcePush && !placeholderOutstanding` so pushes never stack on a placeholder.
*Fix in the working tree, with `historyWrites.test.ts` covering the force-push ×
placeholder interaction.*

### F4 (P2, cross lane 1) — the panel toggle lied with no session on the phone
With no session selected the phone shows the panel as the whole view, but the context bar
still rendered the hamburger with `aria-expanded="true"`, and tapping it pushed a phantom
history entry. `panelToggleHidden` now hides the toggle on the mobile layout when no
session is selected; the property and the conditional render live in `AppContextBar`.
*Fix in the working tree.*

## Judged not true (re-read the source; no change)

### J1 (chat lane 1, "attachment fix absent at HEAD") — superseded reading
The lane reported the capture path had no key check at HEAD. The guard exists in the
working tree as F2 above; the lane read the committed tree before the parallel fix landed.
Same for its sibling claim about `deliverAndRestoreOnFailure` — the restore is
scope-guarded in the same working-tree change.

### J2 (cross lane 1, "hamburger renders while nothing is open") — the control is already hidden
The lane cited `AppContextBar.ts:102-104` as the unconditional render path, but the toggle
button renders behind `panelToggleHidden`, which the shell sets for exactly this state
(mobile layout, no session). The reachable-surface claim does not hold; F4 lands the
remaining half (the hidden-state property itself).

### J3 (cross lane 2, "no theme pack means a fixed dark install") — real, but the fix is a packaging decision
`DEFAULT_THEME_ID = "themes:clay-soft"` resolves against plugin-contributed themes only;
without `@gang-of-beads/pi-web-themes` the resolution falls through to "no theme" and the
`index.html` dark tokens stay. The fallback cannot invent the clay pair — either the pair
ships in core or the install docs declare the theme pack a dependency. Owner call; both
live instances have the pack installed, so the deployed behavior is unaffected.

## Owner calls (not fixed, behavior changes)

### O1 (shell lane 1, P2) — settings popstate never restores the app route
The settings branch of `onPopState` returns after `restoreSettingsRoute()`, so a machine
selection made inside the drawer desyncs URL/state on the way out until the next route
write self-heals. Falling through to `currentRouteMatchesUrl()` would fix it but changes
back-gesture semantics; left to the owner.

### O2 (chat lane 2 vs cross lane) — the compact scope chip is a toggle by design
The lanes disagreed. Reading the source: `openSection` documents the toggle as intentional
("or close it by choosing it again"), and in the no-project state the chip has no honest
action (the projects picker is already the whole screen). The `compactScopeLabel`
docstring ("opens the picker for the level that is not yet chosen") is the one sentence
that is wrong; the behavior stands until the owner says otherwise.

### O3 (cross lane 3/7, report-only) — themes on remote machines and goals-section visibility
A theme pack installed on a remote machine contributes nothing and says nothing; the
contributed goals section is invisible exactly when no session is running. Both are
correct-by-design today; flagged for the owner.

## Still open (P3, not fixed this round)

- `AppNavigationPanel` `.tool-badge` has no `max-width`/ellipsis cap and
  `.compact-scope-name` has no `dir="auto"` — the triage doc's F9/F10 claims predate the
  extraction and never landed. Cosmetic; needs the extraction's CSS contract test.
- `SessionList` collapsible branch renders `section-count` unconditionally
  (`:276`); the branch is dead today (`collapsible=false` everywhere) but the dishonest
  "0" returns if it is re-enabled. One-line gate when touched next.
- `PromptEditor` carries a dead duplicated list media block (`:181-193`) — delete next
  time the file is open.
- `workspaceViewTransition` only guards `view === "chat"`; a tool view that loses its
  workspace becomes a phone dead-end (recoverable via the hamburger). Needs a
  `!hasWorkspace` state plus a test, per the classifier rule.
- Namespaced `tool.<id>.view` params still write without a workspace (URL noise only;
  restore is guarded).
- Settings phone list↔detail swap drops focus (`ModalSurface.focusDialog` exists unused).

## Verification status

- `npm run verify` green at d5dea983: 581 test files, 5173 passed, 5 skipped.
- Plugin matrix probe `scripts/probe-plugin-matrix.mjs`: 15/15 across two runs (phone
  393×850: workspace, files, git, terminal, tasks, relays, updates, info; desktop 1440×900:
  session→chat, goals drawer tab + body, dictate composer slot, themes with the clay pair).
  The goals plugin was installed into the 8505 stack from
  `Gang-of-Beads/pi-web-goals` (flat layout: `package.json`, `pi-web-plugin.js`,
  `server-plugin.js` under `~/.pi-web-8505/plugins/goals`); `/api/plugins` shows it
  enabled with the server side active.
- `scripts/probe-shell-phone.mjs`: full phone flow pass (boot → project → workspace →
  sessions loaded → session 01a selected → files tool → back → chat → back → navigation).
