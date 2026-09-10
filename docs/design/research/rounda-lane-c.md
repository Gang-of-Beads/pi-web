# Lane C — Token & Pattern Layer Audit (pi-web @ refactor/plugin-architecture, live stack :8505)

## 0. Published scales (ground truth)
`src/client/index.html:30-63` — spacing `--pi-space-1..9` (2/4/6/8/10/12/16/20/24px); type `--pi-text-2xs..xl` (11/12/13/14/15/17/20px); radius `--pi-radius-xs/md/lg/xl` (0/2/3/4px) **plus `--pi-radius-pill: 999px`**; palette `--pi-border #292f38`, `--pi-border-muted #1e232b`, `--pi-surface #13161b`, `--pi-bg #0b0d10` (index.html:146-152).
Guard tests all pass at HEAD: spacingScale / typeScale / radiusScale / tokenReferences / designTokens = 49 tests green. So every finding below is a *semantic* escape the regex guards structurally cannot catch.

---

## F1. Round fold button in phone header — TRUE (owner flagged; live-verified)
- Owning style: `src/client/src/components/appShell/AppNavigationPanel.ts:463` — `.compact-header-action { ... border-radius: var(--pi-radius-pill); ... }`; the fold button reuses it via `.compact-fold` (:459), whose "Squared, glyph-only" override (:465-467) removes only `padding`, not the radius.
- Live at 393x850 (touch), `/tmp/rounda-c-probe2.mjs` / `probe5`: fold button box **44×44**, computed `border-radius: 999px` → perfect circle. `topGap = 0` (tangent to the top of the screen) and `bottomGap = 1` — the circle's bottom edge sits exactly on the header's 1px `border-bottom: 1px solid var(--pi-border)` (`/tmp/rounda-c-phone393.png`, `/tmp/rounda-c-phone-sessions.png` top-right).
- Aggravating inconsistency: the same row declares `--pi-header-control-radius: var(--pi-radius-md)` (AppNavigationPanel.ts:447) precisely so header controls follow the square language; the sibling refresh button consumes it (`AppRefreshControl.ts:40`, radius = 2px), but `.compact-header-action` hardcodes `--pi-radius-pill` and ignores the variable. Same 44px row: one 2px-square control next to one full circle.
- Adjudication: **TRUE** — a 999px token exists in the scale, so radiusScale.test.ts passes, but the token choice contradicts both the square language and the row's own `--pi-header-control-radius` mechanism. Fix is one line: `border-radius: var(--pi-header-control-radius, var(--pi-radius-md))` on `.compact-header-action`.

## F2. Sessions heading row: huge uneven gaps on phone — TRUE
- Owning styles: `shared.ts:257` `h2 { justify-content: space-between; gap: var(--pi-space-4) }`; `SessionList.ts:702` `h2 { gap: var(--pi-space-2) }`; `SessionList.ts:703` `@media (pointer: coarse) { h2 { gap: var(--pi-space-8) } }` (20px); `SessionList.ts:708` `h2 > .bulk-select-entry { margin-left: auto }`.
- Live at 393x850 (coarse): computed `justify-content: space-between`, `gap: 20px` on the Sessions h2 (probe5/probe7). The comment at SessionList.ts:704-706 says the intent was "one group, pushed right"; but `margin-left: auto` absorbs ALL free space, leaving `space-between` with nothing to distribute — net layout is: `Sessions |←viewport-dependent auto gap→| checkbox | 20px | count | 20px | Clean up | 20px | +New session`. The auto gap dwarfs the 20px steps and varies with title length → exactly the "huge uneven gaps" the owner sees. Two competing distribution mechanisms (`space-between` + `margin-left:auto`) is the root cause; one should go.
- Adjudication: **TRUE**. Fixed 20px between trailing controls is defensible; the unbounded auto gap + redundant space-between is the defect.

## F3. Button boundaries barely visible in flat theme — TRUE (quantified)
- Owning tokens: `index.html:151-152` `--pi-border: #292f38`, `--pi-border-muted: #1e232b` on `--pi-surface: #13161b` / `--pi-bg: #0b0d10`.
- Contrast (WCAG relative luminance): border vs surface **1.35:1**, border vs bg **1.44:1**, border-muted vs surface **1.15:1**, border-muted vs bg **1.23:1**. All far below the 3:1 non-text contrast floor (WCAG 1.4.11). In a flat theme (no shadows — `--pi-elevation-*` aside, cards/buttons are distinguished by border alone), 1.35:1 is the entire boundary signal — matches live screenshot `/tmp/rounda-c-desk-full.png` where project-card outlines are barely perceptible.
- Live computed styles confirm all rendered buttons carry `rgb(41, 47, 56)` borders on `rgb(19, 22, 27)` surfaces (probe5 borderKinds: 34 session rows, fold, section-add, etc.).
- Adjudication: **TRUE** — token values themselves are the defect; needs a palette-level fix (lighten `--pi-border`, e.g. one surface step up), not per-component patches.

## F4. "New session" title not centered — PARTLY TRUE (misdiagnosed surface; empty states are actually centered)
- All shared empty states ARE centered: `shared.ts:169-171` `.empty-state { margin: auto; ... text-align: center }`; `ChatView.ts:367` `.empty-session { justify-items: center; text-align: center }`; `PiWebApp.ts:186` `.empty { margin: auto; align-items: center; text-align: center }`. Live: `Select a project...` empty state measured `textAlign: center`, leftInset = rightInset = 0 (probe5). Clean.
- The "New session" the owner sees is the QuickSwitcher create tile: `QuickSwitcher.ts:168-177` renders it as a normal list `.row` with `text-align: left` (QuickSwitcher.ts:428). Live at 393x850 (`/tmp/rounda-c-phone-sessions.png`): box **371×78**, title "+ New session" at top-left (inset 11px top / 13px left), subtitle "Select a workspace first" pinned at bottom-left (11px from bottom) — a 44px internal void between them. It is the first, visually dominant card of the sheet and reads like an empty-state/CTA, but is styled as a data row.
- Adjudication: **TRUE for the create tile** (left-aligned title in a tall prominent card, inconsistent with the app's centered empty-state language — `QuickSwitcher.ts:428` `text-align: left` applied to `.create-row`); **FALSE for actual empty states**, which measure centered.

## F5. Pill radius survivors in the square language — TRUE (scale-legal, pattern-inconsistent)
- `--pi-radius-pill: 999px` is in the published scale (index.html:63), so the radius guard passes; but 25 declarations across 14 files use it (grep count). Notable control-shaped (non-badge) survivors:
  - `AppNavigationPanel.ts:463` `.compact-header-action` (fold button, see F1);
  - `ChatView.ts:224` `.activity-dock` (the "Waiting for your answer" pill, `/tmp/rounda-c-phone-panel.png`);
  - `ChatView.ts:325` `.history-load-button`, `:331` `.queued-strip`, `:342` `.queued-clear-button`;
  - `AppNavigationPanel.ts:463` Settings/Actions buttons and `AppNavigationPanel.ts:483` `.tool-badge`;
  - `QuickSwitcher.ts:458` `.chip` — live at 393x850: 44px-tall chips with radius 999px sitting directly above `.machine-tab` (radius `2px 2px 0 0`, QuickSwitcher.ts:452) in the same sheet — two control shapes 4px apart vertically;
  - `git-panel.ts:1328,1351` mirrors shared.ts:182/388 badges.
- Legitimately circular (not offenders): status dots `border-radius: 50%` (shared.ts:463-477, ChatView.ts:262) — indicators, not controls.
- Adjudication: **TRUE** — badges/count pills are a defensible micro-convention, but pill radii on full-height *controls* (fold, dock, chips, history-load) collide with the 0-4px square language; the pill token is doing control-shape work the scale never intended.

## F6. Spacing values repeating with no token — MOSTLY FALSE (one small residual)
- The guard (`spacingScale.test.ts:17-46`) whitelists off-scale trims **3 and 5px** explicitly ("asymmetric trims… named here so a new one has to be argued for"). Grep finds only **2** live declarations using literal 3px/5px — the whitelist is not leaking; the scale + documented trims cover actual usage. Above-scale literals are structural (44px controls, 56px rows) and out of the rhythm's jurisdiction by the guard's stated contract.
- Minor repeats that are *not* spacing but repeat tokenlessly: `min-width: 14px` + `line-height: 16px` badge sizing duplicated 4× (SessionList.ts:710, ChatView.ts:160, AppNavigationPanel.ts:483, QuickSwitcher.ts `.row-tag`) and `width/height: 16px`/`20px` icon boxes (SessionList.ts:711, AppNavigationPanel.ts:457 tool-icon 20px). No token exists for badge/icon sizing; they agree today only by copy-paste.
- Adjudication: spacing-scale bypass — **FALSE** (clean; guard + whitelist hold). Tokenless repeated *sizing* constants (14/16/20px) — **TRUE but minor**.

## F7. Type sizes outside the scale — FALSE (clean)
- `typeScale.test.ts` passes: zero `font-size: NNpx`, zero `font: NNpx` shorthands, focus ring on `--pi-focus-ring-width`, weights on the ramp in both `src/client/src` and `pi-web-plugins`. The only 16px literals are `--pi-control-font-size: 16px` (index.html:143) and its consumers via `var(--pi-control-font-size, 16px)` fallbacks (e.g. SessionList.ts:801, QuickSwitcher rename-input) — a published token with its own documented iOS-zoom rationale, not a scale escape.

---

## Live probes
- Scripts: `/tmp/rounda-c-probe2.mjs`, `probe5.mjs`, `probe6.mjs`, `probe7.mjs`, `probe8.mjs`, `probe9.mjs` (playwright, repo node_modules, no repo writes).
- Screenshots: `/tmp/rounda-c-phone393.png`, `/tmp/rounda-c-desk1280.png`, `/tmp/rounda-c-phone-sessions.png` (quick switcher + fold circle + pills), `/tmp/rounda-c-phone-panel.png` (chat + activity-dock pill), `/tmp/rounda-c-phone-nav.png`, `/tmp/rounda-c-desk-full.png`, `/tmp/rounda-c-desk-sessions.png`.
- Repo untouched; guard tests run read-only; dev stack not restarted.

## Priority for coordination
1. F1 fold-button radius (1-line fix, owner-flagged, live-verified).
2. F3 border token lightness (palette-level, fixes "boundaries barely visible" app-wide).
3. F2 heading distribution (drop `margin-left:auto` *or* `space-between`, keep one).
4. F4 center the create-tile content in QuickSwitcher (align with empty-state language).
5. F5: decide pill-for-badges-only as a written convention; convert pill controls to `--pi-radius-md/lg`.
