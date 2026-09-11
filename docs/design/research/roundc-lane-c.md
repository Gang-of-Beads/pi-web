# Round C — Lane C: token & pattern layer (convergence verification)

Config: live stack http://localhost:8505/, branch `refactor/plugin-architecture` @ 720b589c.
Playwright chromium; phone 393x850 (Pixel 7, hasTouch, isMobile), desktop 1280x850, mid 768x850.
All measurements from computed styles / bounding rects via evaluate (shadow-DOM piercing); screenshots in /tmp/roundc/.
Guard suites re-run before browsing: **53/53 pass** (spacingScale, typeScale, radiusScale, controlHeightScale, dotScale, tokenReferences, designTokens).

---

## 1. Round B fix verification — 5 of 7 reached the reader, 2 did not

| # | Round B claim | Verdict | Live evidence |
|---|---|---|---|
| 1 | new-session empty state centered (`min-height: 100%`) | **REACHED** | content block centered exactly: 393 → 236px above / 236 below; 768 → 236/236; 1280 → 245/245 (`ChatView.ts:367`) |
| 2 | theme cards unclamped (buttons min-height; inputs/selects pinned) | **REACHED** | 1280: 11 theme cards 233x193 each, no overlap; 393: 11 cards 181x183, rows at y=328/519/710/902 uniform; settings inputs AND selects all exactly 32px live |
| 3 | tasks/relays viewers fill panels | **FILL reached; claimed centering reached relays only — tasks did not (TRUE-1 below)** | both viewers fill: tasks `section.viewer.tasks-viewer` [870,86 410x764] in panel-content [870,33 410x817]; relays same |
| 4 | five more pressed states | **REACHED** | source-verified live rules: `AppNavigationPanel.ts:464` (compact-scope/session/header-action), `AppContextBar.ts:74` (all context-bar buttons), `QuickSwitcher.ts:421` (close), `ChatView.ts:408` (msg-action/activity-dock/drawer-tab), `SessionList.ts:818` (menu/cleanup/bulk-select) |
| 5 | extension-card button boundaries | **REACHED** | live card [357,345 496x265] bg raised rgb(53,56,60); all three buttons (Update now/Skip/Cancel) `1px solid rgb(58,66,78)` (`ExtensionDialogCard.ts:426` region) |
| 6 | actions-row reading edge | **REACHED** | phone fold-open: `.compact-header` padding 2px 10px, `.compact-actions-row` padding 4px 10px; header content x=10, actions-row buttons x=10/…, right edges both 383 (`AppNavigationPanel.ts:461`) |
| 7 | solid header dividers (msg headers) | **NOT REACHED — TRUE-2 below** | live msg-header borders still `color(srgb … / 0.35)` |

---

## 2. Failed verifications (the round's two TRUE findings)

### TRUE-1 — Tasks empty state never centered; sibling Relays centers. Round B's "center for real" reached only one of the two producers.
- Owning styles: `pi-web-plugins/workspace-tasks/tasksPanelElement.ts:287` (`.viewer` — the wave added `flex: 1 1 auto; … display: flex; flex-direction: column`) **overridden on the very next line** by `:288` `.tasks-viewer { display: grid; align-content: start; gap: … }`. Relays: `pi-web-plugins/relays/relaysPanelElement.ts:515` `.viewer { display: grid; align-content: stretch; … }` (the wave's fix, effective).
- Compared elements: `.empty-state` in tasks viewer vs `.empty-state` in relays viewer, same wave, same claim ("so the auto margins center for real", commit 1dde944d, changeset `goal-round-b-rereview.md`, triage doc §fixed).
- Measured, desktop 1280 (tasks tool open): tasks viewer [870,86 410x764], empty-state [882,**98** 386x81] — 12px below the viewer top (= the viewer's own 12px padding; `margin: auto` resolves 0 in a content-sized grid row under `align-content: start`). Relays viewer [870,86 410x764], empty-state [882,**428** 386x81] — 342 above / 341 below: centered.
- Measured, phone 393 (sessions list → Tasks tool): viewer [0,110 393x740], empty-state [12,**122** 369x81] — top-anchored at both widths.
- Screenshots: /tmp/roundc/desktop-tasks-tool.png, /tmp/roundc/desktop-relays-tool.png, /tmp/roundc/phone-tasks-tool.png.
- Adjudication: **TRUE.** Two sibling plugin panels render the same dashed-empty-state pattern at different vertical anchors; the Round B fix claim is half-true. One-line class of fix: give `.tasks-viewer`'s empty state the relays treatment (or drop the `:288` display/align-content override when empty).

### TRUE-2 — "Solid muted border" msg-header dividers: claimed fixed in three places, the fix was never written.
- Claimed: commit message 1dde944d, `.changeset/goal-round-b-rereview.md`, `docs/design/review-triage-goal-round-b.md` §"Also fixed" — "solid muted border instead (one rule per role block)".
- Reality: `git show 1dde944d -- src/client/src/components/ChatView.ts` contains only the `min-height: 100%` hunk and the drawer-tab `:active` hunk. Source unchanged: `ChatView.ts:379` `.msg > .msg-header`, `:380` (user), `:385` (tool), `:386` (bash), `:387` (skill), `:388` `.group-msg > .msg-header` — all still `border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent)`.
- Live measured (session open, 1280): assistant header border `color(srgb 0.149 0.173 0.208 / 0.35)` composited over surface-card rgb(36,39,44) → **1.02:1** (invisible; solid border-muted would be 1.07:1); group header over canvas → 1.09:1; user variant (accent tint over selection) → 1.62:1 (barely visible).
- Same symptom, second producer the fix never enumerated: `src/client/src/components/AskUserCard.ts:496` `.card-header` — same 35%-alpha border-muted over `--pi-surface-raised` rgb(53,56,60) → **1.07:1** (solid would be 1.19:1).
- Screenshots: /tmp/roundc/desktop-msg-headers.png, /tmp/roundc/desktop-session-messages.png.
- Adjudication: **TRUE.** A recorded-as-fixed item that the reader never received; the sticky headers still float borderless on their cards. (Note for the fixer: solid `--pi-border-muted` only reaches 1.07/1.19:1 — decide the level, then write it once for all seven role blocks + the AskUserCard header.)

---

## 3. Owner's four complaints — re-measured

1. **Alignment** — clean within columns. Phone 393: compact-header text x=10 = sessions h2 x=10 = rows/tiles x=10 = search x=10; fold right edge 383 = `+ New session` right edge 383. Desktop 1280 rail: header x=16 = chips seg x=16(=17 incl. border) = h2 x=16 = tiles x=16. Chat column: context-bar x=6, chat gutter 6 (deferred cross-column contract, below). **FALSE (clean)**; the nav-10/chat-6/desktop-16 cross-column question remains ledger-deferred.
2. **Whitespace rhythm** — phone sessions heading row (h2 [10,55 373x44]): word → bulk-select 26px, bulk-select → Clean up 26px, Clean up → + New session 25px — uniform `space-between` distribution; this is the recorded deferral ("25.9 phone / 9.6 desktop", touch-density call), numbers unchanged. Desktop h2 gaps 9.5–9.6 uniform. **FALSE (deferred, unchanged).** One unowned value found: the desktop `main .empty` renders a bare `<p>` (`PiWebApp.ts:4027`) whose UA 14px margins are un-reset (`.empty` at `PiWebApp.ts:140/:185` has no `p` reset; the phone twin does, `ChatView.ts:368`). It happens to render symmetric (31px above/below the single line) so **FALSE as a defect**, but it is exactly the "value no token owns" class — one `p { margin: 0 }` closes it next time the file is touched.
3. **Button boundaries** — every measured control carries `1px solid var(--pi-border)` (#3a424e) on `--pi-surface`; accepted hairline = 1.79:1 (Round A level, unchanged). Settings inputs/selects/buttons bounded; context-switcher chips are regions inside a bordered 44px `.seg` (chip 42 = 44 − 2×1px border — coherent). **FALSE (clean).**
4. **Fold button (phone top-right)** — `.compact-fold` [339,2 44x44] in a 49px `.compact-header` (2px top pad, border-bottom at y=48): **2px top / 2px bottom breathing, radius 2px** — square, in the radius language; the circle is gone. 2px is the arithmetic maximum while the control holds the 44px touch floor. **FALSE (closed).** Cross-check on desktop: rail/drawer/workspace headers all run their controls flush (0/0/+1px border) — consistent across all three desktop headers, i.e. a deliberate desktop density language, not a stray. **FALSE.**

## 4. NEW hunt — "New session" centering on every surface

| Surface | Result |
|---|---|
| Phone 393 chat empty-session | content 236/236 — dead center ✓ |
| 768 chat empty-session | 236/236 ✓ |
| 1280 chat empty-session | 245/245 ✓ |
| 1280 main `.empty` ("Select a project…") | vertical 362.75/362.75 below the 45px context bar; horizontal 241/241 ✓ |
| Tasks panel empty state | top-anchored — the one non-centering empty state (TRUE-1) |
| Relays panel empty state | 342/341 centered ✓ |

The `.empty-session` box rect sits 8px above its `.chat` parent's top (y=82 vs 90) at every width — transparent, borderless, no visual effect; **FALSE** (noted so no lane re-hunts it). Screenshots: /tmp/roundc/phone-empty-centering.png, /tmp/roundc/newsession-768.png, /tmp/roundc/newsession-1280.png, /tmp/roundc/desktop-empty-session.png.

## 5. Token/pattern layer clean sweep

- **Guards**: 53/53 pass (spacing 2–24 px-literal, type literals, radius literals, control heights 28–44, dot sizes, token references, shared-sheet scale spend).
- **Live computed audit** at 393 / 768 / 1280 across: base lists, compact header, sessions view, quick switcher, context sheet, settings General + Appearance, tasks/relays tools — **zero off-scale computed spacing** (only the UA 14px `p` margin in §3.2), **zero off-scale type** (all sizes ∈ {11,12,13,14,15,16,17,20}), **zero off-scale radius**.
- **em/% spacing**: none in any component or plugin sheet.
- **Radius language**: live pill/50% inventory = state dots (dot motif, 6/8px) and 16px-tall `row-tag`/badge stamps only; no interactive control wears a pill. Badge-only convention held — the ledger's "pill badges" deferral stays accurate.
- **Borders that vanish**: the only surviving sub-perceptual alpha borders are the msg-header/AskUserCard dividers (TRUE-2). Everything else measured solid.

## 6. Ledger cross-check (owner-deferred items, re-quantified, unchanged)

- Phone heading rhythm 26/26/25 vs desktop 9.5/9.6 — unchanged (deferred).
- Section padding systems nav 10 / chat 6 / desktop 16 — unchanged (deferred; chrome-inset contract comment in place).
- Settings panel indent 13px (settings-card x=261 → effective-card x=274 at 768) — unchanged (deferred).
- Pill badges — held at badge-only (deferred, accurate).
- Context-bar ☰ vertical flush (Round B lane A §3.3 "TRUE"): adjudicated **FALSE at rest** here — the toggle draws no border/background, so nothing visibly touches; the 0px is invisible geometry, and the 45px height is the documented height-parity decision (`AppContextBar.ts:72` comment). Recorded here because it fell out of Round B's final ledger: it is neither in the fixed list nor the deferred list. Recommend the ledger carry it (or the next wave grants the context-bar the compact-header's 2px).

## 7. Bottom line

Convergence bar **not met on two Round B fix claims** (not new defects — Round B's own finds whose fixes did not reach the reader):
1. TRUE-1 tasks empty-state anchor (half of a claimed two-panel fix),
2. TRUE-2 msg-header solid dividers (claimed in commit/changeset/triage, absent from the diff, 1.02:1 live, plus the un-enumerated AskUserCard producer).

Everything else the round hunted — empty-state centering at three widths, theme cards, pressed states, extension boundaries, reading edges, token discipline at the computed level — is verified clean at the reader.

Screenshots: /tmp/roundc/*.png (phone-initial/sessions/new-session/empty-centering/fold-open/quickswitcher/context-sheet/settings/settings-appearance/tasks-tool, desktop-projects/empty-session/header-zone/settings/settings-appearance/session-open/tasks-tool/relays-tool/session-messages/msg-headers, newsession-768/1280).
