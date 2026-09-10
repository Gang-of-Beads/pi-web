# Lane C — Round B: Token & Pattern Layer Re-Review (pi-web @ refactor/plugin-architecture, live :8505)

Method: source audit of the published scales against all client + plugin style strings
(336 non-test .ts files under `src/client/src` and `pi-web-plugins`), guard tests re-run
(spacingScale / typeScale / radiusScale / tokenReferences / designTokens = **49 passed**),
then live Playwright measurement at 393×850 (coarse) / 768 / 1280 with computed styles +
bounding rects. Scripts and screenshots in /tmp only (`/tmp/roundb-c-*.mjs`, `/tmp/roundb-c-*.png`);
no repo files modified; stack not restarted.
Probe side effect (disclosed): verifying "New session" created 3 empty sessions
(393 / 768 / 1280 runs) in the test workspace; nothing deleted or archived.

---

## 1. Round A fixes — did each reach the reader?

### 1.1 Fold button: radius + insets — REACHED ✓
- Owning style: `src/client/src/components/appShell/AppNavigationPanel.ts:463` (`.compact-header-action` consumes `--pi-header-control-radius`, declared :447).
- Live 393×850: `.compact-fold` = 44×44 at (339,2), computed **border-radius: 2px** (was 999px). `.compact-header` h=49, padding **2px 10px**, border-bottom 1px → gapTop **2px**, gapBottom **2px + 1px border** (was 0/1 tangency). Right edge 383 = `+ Add project`/`+ New session` right edge 383 (was 387 vs 383).
- Adjacent sibling `.compact-scope` same radius 2px, same row — one radius language in the header.
- Adjudication: **TRUE (fixed)**. Screenshot `/tmp/roundb-c-phone-boot.png`.

### 1.2 Sessions heading distribution — REACHED ✓
- Owning styles: `shared.ts:257` (`h2 { justify-content: space-between; gap: var(--pi-space-4) }`), `SessionList.ts:702-703` (gap space-2 desktop / space-6 coarse — stepped down from space-8).
- Live 393: h2 kids at x = 10 / 93.7 / 163.6 / 267.3 → gaps **25.9 / 25.9 / 25.9** (uniform; was 37.7/20/20). Computed gap **12px** (was 20).
- Live 1280: x = 16 / 83.4 / 124.9 / 208.3 → gaps **9.6 / 9.5 / 9.6** uniform. Row right edge 324 = session-row right edge 324; phone 383 = 383.
- Residual (owner-deferred, unchanged): phone distributes to 25.9 vs desktop 9.5 — a 2.7× same-row rhythm across pointers. It is now *even*; looseness remains a touch-density decision, not a defect.
- Adjudication: **TRUE (fixed; deferred looseness re-quantified)**. Screenshots `/tmp/roundb-c-phone-workspace.png`, `/tmp/roundb-c-desk-sessions.png`.

### 1.3 Border contrast — REACHED as decided, with a NEW evasion class (see N2)
- Owning tokens: `src/client/index.html:148-149` — live computed `--pi-border` = **#3a424e**, `--pi-border-muted` = **#262c35**, surface #13161b.
- Live consumers verified: `.action-row` tiles `1px solid rgb(58,66,78)`, `.compact-fold`, `.section-add`, composer `.cm-editor` — all on the new border.
- Contrast recomputed: border/surface **1.79:1** (was 1.35), border/bg 1.83:1; border-muted/surface **1.29:1** (was 1.15). Discernible in screenshots (tile outlines, Reload ghost in `/tmp/roundb-c-desk-settings.png`).
- Note for the record: still below the 3:1 non-text floor Round A's own F3 cited; triage accepted ~1.8:1 as the flat-theme decision. Muted borders remain sub-1.3:1.
- Adjudication: **TRUE (fixed to the decided level)**; the 35%-alpha color-mix dividers below are the part the lift never touched.

### 1.4 Column edges — REACHED ✓ (two 1px-class residuals)
- Phone 393: `.compact-scope` text x=10 = section h2 x=10 = `.list-search-input` x=10 = tile box (`.action-row`) x=10 — one reading edge (`--pi-reading-edge: space-5` at index.html:207-209). Right anchors: fold 383 = section-add 383 ✓.
- Desktop 1280 rail: header text x=16 = section h2 x=16 = search box x=16 = `.action-row` box x=16 ✓ (Round A's 6/11/16 collapsed).
- Residuals: (a) context chips at x=**17** vs 16 everywhere else in the same column — 1px; (b) chat column edge 6 vs list edge 10 on phone — the documented four-value padding split (deferred, unchanged).
- Adjudication: **TRUE (fixed; two minor residuals recorded)**.

### 1.5 Empty states — PARTIALLY REACHED; the headline claim is inert (N1)
- QS create tile: centered title "+ New session" / subtitle "Select a workspace first" ✓ (visible, `/tmp/roundb-c-phone-sessions.png`); tile 371×78, radius 3px, accent border — now reads as the CTA it is.
- The actual new-session empty state: **NOT centered at any width** — see N1.

### 1.6 Files toolbar floor + pressed states — REACHED ✓
- `pi-web-plugins/files/filesPanelElement.ts:502` coarse floor: live Upload/Refresh buttons **44px** tall on phone (was 32), `:active { background: var(--pi-surface-hover) }` at :503.
- Pressed state verified with real input on `Clean up` (`SessionList.ts:818`): rest `rgba(0,0,0,0)` → pointer-down **rgb(27,32,39)** (`:active` matches). The covered family works.
- Adjudication: **TRUE (fixed)**. Screenshot `/tmp/roundb-c-phone-tool-files.png`.

### 1.7 Tile edge — REACHED ✓
- Visible tile box is `.action-row` (border owner, `shared.ts:358`): live x=10, w=182.5, 1px solid rgb(58,66,78), radius 2px = the section reading edge exactly; `.action-main` (transparent button) inside is not a visible edge.
- Adjudication: **TRUE (fixed)**.

### 1.8 Heading rhythm — REACHED ✓
- Context sheet word-headings (`ContextSwitcherSheet.ts:93` var channel): live sheet h2 "Projects" marginBottom **4px** = list h2 marginBottom 4px (`shared.ts:285-291`). One rhythm across surfaces; the 8/4/8 split is gone.
- Adjudication: **TRUE (fixed)**. Screenshot `/tmp/roundb-c-phone-sheet.png`.

### 1.9 Tasks title — REACHED ✓ (visual spot-check)
- `phone-tool-tasks.png`: panel title renders "Tasks", matching the tab label.

---

## 2. NEW findings (what Round A missed)

### N1. The new-session empty-state fix is structurally inert — TRUE (P0)
- Owning style: `src/client/src/components/ChatView.ts:367` — `.empty-session { … align-content: center; margin: auto; … }` (fix commit cad91351).
- Why it can't work: the fix centers the *element in its parent*, but the parent `.chat` is `display: block; overflow: auto` (measured live). In block layout vertical `margin: auto` computes to **0** and the element's own `align-content` only arranges its internal tracks. Measured computed margin on `.empty-session`: **0px**.
- Numbers at all three widths (same DOM): element y=**114**, h≈121, parent `.chat` spans y=90..658.8 → **24px above, 423px of void below** (393 and 768); desktop h=103.5 → **441px void below**. Screenshots: `/tmp/roundb-c-phone-new-session.png`, `/tmp/roundb-c-768-new-session.png`, `/tmp/roundb-c-desk-new-session.png` (text clings to the top in all three).
- Fix (one line, pick one): `.empty-session { min-height: 100% }` (fills the scroller; its existing `align-content: center` then centers for real) or make `.chat` `display: grid` with a single child.
- Adjudication: **TRUE — claimed fixed in Round A triage, not delivered to the reader.**

### N2. Message-header dividers vanish — the border lift's blind spot — TRUE
- Owning styles: `ChatView.ts:379` `.msg > .msg-header` and `:388` `.group-msg > .msg-header` — `border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent)`; role variants :381/:384/:386/:387 tint at the same 35%.
- Live measured: assistant header border `color(srgb 0.149 0.173 0.208 / 0.35)` over card bg `srgb(0.141 0.152 0.171)` → composite ≈ **1.03:1** against its own card (group headers on bg ≈ **1.09:1**). A "divider" at 1.03:1 does not divide; the sticky header floats borderless in the card (user-role variant is tinted blue and reads at ≈1.6:1 — visible only because it's on the accent fill).
- This is the same defect class Round A fixed for `--pi-border` itself; these rules bypass the token's strength with an alpha multiplier the palette lift never adjusted.
- Fix: drop the alpha (solid `var(--pi-border-muted)` ≈ 1.29:1) or raise the mix — one rule per role block.
- Adjudication: **TRUE**. Screenshot `/tmp/roundb-c-phone-chat.png`.

### N3. Leading literals bypass the published leading ramp — TRUE (pattern gap)
- Published ramp: `index.html:50-51` — `--pi-leading-tight: 1.25`, `--pi-leading-normal: 1.45` (and index.html:257-259 sets body to tight "so mixed leading doesn't read misaligned").
- Actual usage (grep, 336 files): `line-height: 1.4` ×14, `1.3` ×11, `1.35` ×10, `1.5` ×2, `1.2` ×5, `normal` ×2 — **44 declarations at five values the ramp does not publish**, across 23 files (top: AskUserCard ×8, shared ×4, SettingsPluginsPanel ×3, PromptEditor ×3, ExtensionDialogCard ×3, ProjectDialog ×3; also files/terminal/relays plugin panels).
- `typeScale.test.ts` guards only `font-size`; leading has no guard and no token coverage, so two sibling texts can breathe differently with no test to argue with (e.g. tile captions 1.3 vs badge 16px-fixed vs prose 1.45).
- Fix: either publish 1.3/1.35 as named steps or convert literals to the two tokens; a one-line addition to typeScale.test.ts guards whichever is chosen.
- Adjudication: **TRUE** (the one type-scale escape the guard structurally cannot see).

### N4. Panel toolbar rhythm still splits 8 vs 10/12 — TRUE (deferred, freshly quantified)
- Owners: `shared.ts:180` (`.toolbar { padding: var(--pi-space-4) }` = 8, consumed by Files via adopted `workspacePanelStyles`, and by Updates/Info), vs private overrides `pi-web-plugins/workspace-tasks/tasksPanelElement.ts:285` and `pi-web-plugins/relays/relaysPanelElement.ts:508` (`padding: var(--pi-space-5) var(--pi-space-6)` = 10/12).
- Live 393, all toolbars at y=45 in one workspace: Files h=**61** pad 8px title x=8; Tasks h=**65** pad 10px 12px title x=12; Relays h=**65** pad 10/12 x=12; Updates/Info h=**33.3** pad 8 x=8; Terminal renders its toolbar only in copy mode (`TerminalPanel.ts:763`: pad 6, **min-height: 47px** — a fifth value when it appears).
- Adjacent taps (Files→Tasks) still jump title x 8→12 and band height 61→65.
- Lazy fix: one `--pi-panel-toolbar-padding` token in index.html, consumed by all five; deletes both private paddings and the 47px orphan.
- Adjudication: **TRUE (still open; triage deferred it — numbers updated for the decision)**.

### N5. Files panel: three internal left edges + tree rows below the app's own touch floor — TRUE (minor)
- Phone 393: toolbar title x=**8**, tree row box x=**6** (`.list` pad 6), tree row content x=**12** (row pad `4px 6px`, `shared.ts:189`) — three edges in one panel; desktop mirrors it (title 878.4 / row box 876.4 / content 882.4 in the 409.6px panel).
- Tree rows h=**32** on coarse pointers — while Upload/Refresh in the same panel obey the 44 floor (`filesPanelElement.ts:502`). The floor token exists (`--pi-control-height-touch`); the tree doesn't consume it.
- Adjudication: **TRUE (minor; single-owner fix in filesPanelElement/shared `.list` padding + coarse row floor)**.

### N6. Goals drawer row: off-edge content, flush control, no pressed state — TRUE (minor)
- Measured phone 393 (workspace nav): `pi-web-goals-section` row spans 0..393 full-bleed; text content x=**16** while the session rows above and tool tiles below sit on the reading edge x=**10**; the `.refresh` button is 44×44 at x=349..**393** — flush to the physical screen edge (right inset 0) where every other control in the panel anchors at 383.
- `pi-web-plugins/goals/goalsSectionElement.ts:24` — `.refresh` has hover only, no `:active` → zero touch feedback (the exact gap Round A's pressed-state wave closed elsewhere).
- Adjudication: **TRUE (minor; align content to reading-edge, inset the refresh to 383, add the shared `:active`)**.

### N7. Ghost-control pressed states: coverage gaps remain — TRUE (residual family)
- Round A's wave covered: SessionList trio, ChatView dock/msg-action (coarse), SettingsDialog close (coarse, `:769`), ContextSwitcherSheet close (`:90`), Files toolbar. Verified working (1.6).
- Still hover-only or bare under coarse pointers (source-verified; hover rules can't fire on touch):
  - `QuickSwitcher.ts` `.close` — **measured live**: 44×44 at (338,113), transparent, border 0, no hover/active rule at all (screenshot `/tmp/roundb-c-phone-qs-close.png`); `.row-menu button` hover-only (`:521`).
  - `SessionCleanupDialog.ts:247-248` `.close-button` — hover only (modal).
  - `PromptHistoryPanel.ts:129,134` `.close`/`.entry` — hover only (panel reachable on phone).
  - `AppContextBar.ts` `.panel-toggle` — no hover or active rule.
  - `SettingsDialog.ts:799` `.settings-back` — none.
  - `git-panel.ts:1341,1345` `.git-row`/`.git-commit-row` — hover only; `.git-review-toggle`/`.git-commit-file-toggle` no pressed state.
- Fix: extend the established one-line pattern (`:active { background: var(--pi-surface-hover) }` under `@media (pointer: coarse)`).
- Adjudication: **TRUE (the wave reached its named targets; the family has unconverted siblings)**.

### N8. Minor unowned constants — TRUE but small
- Badge/icon sizing constants repeat tokenlessly: `min-width/height: 14px` + `line-height: 16px` badge boxes in `AppNavigationPanel.ts`, `ChatView.ts`, `SessionList.ts` (3 files, was 4 in Round A — QuickSwitcher still carries `line-height: 16px` on `.row-tag`), 20px tool icons (`AppNavigationPanel.ts:457` area, `AppNavigationPanel` dump: `span.tool-icon 20x20`). No `--pi-badge-*` token exists; they agree only by copy-paste.
- Compact header titles 13px (`--pi-text-sm`) vs desktop session-row names 14px (`--pi-text-base`) — the deferred type step, unchanged.
- Adjudication: **TRUE (minor)**.

---

## 3. Clean bills (measured, so nobody re-hunts)

1. **Spacing-scale discipline is real**: 1094 `var(--pi-space-*)` references; a full scan of spacing-bearing declarations (padding/margin/gap/top/right/bottom/left/inset) across both roots finds **zero bare on-scale px literals** — only 0/1px, five structural reservations (36/44/52/58px in `PromptEditor.ts:106,131,171` composer gutter, 9999 clamp). The "extremely loose in places" feeling no longer comes from unowned padding literals; what remains is distribution decisions (1.2 residual) and N1's dead space.
2. **Radius scale**: zero literal px radii; the remaining `--pi-radius-pill` users (17 selectors) are all badges/stamps/meter tracks (`.stale`, `.badge`, `.tool-badge`, `.override-badge`, `.row-tag`, `.marker`, `.kind`, ConversationMeter, git badges) — the badge-only convention Round A proposed is now actually held. All Round A control offenders measured 2px live: activity-dock, history-load-button, queued-strip/clear, QS chips, compact-fold.
3. **Type sizes**: zero font-size literals (guard holds; only the documented `--pi-control-font-size: 16px` channel).
4. **Border colors**: zero hex literals — every border is a token, `currentColor`, `transparent`, or a color-mix of tokens (the mixes are N2's finding, a strength problem, not a palette escape).
5. **QuickSwitcher control language**: chips 2px (`:472`), machine-tabs `2px 2px 0 0` with -1px overlap (`:452` area), create-tile 3px — one square family, no pill/square collision (Round A F5's QS pair, resolved).
6. **Sessions h2 right edge = row right edge** at both widths (383/383, 324/324).
7. **Chat gutter holds**: msg cards x=6 w=381 = `.cm-editor` x=6 w=381 = activity dock x=6 on phone; 16 on desktop — the shared-gutter promise (index.html:222-225) still pixel-true.
8. **Compact actions row breathing** (Round A P1 residual): row y=49 (below the 49px header), buttons 44px at y=53 → 4px top / 4px bottom inset, gap 8 — closed.
9. Border-token values live-match source (#3a424e / #262c35 / #13161b read from `:root`) — hot-reload is serving current source.

## 4. Priority for coordination

1. **N1** — empty-state centering is inert at all widths (owner-flagged NEW item; one-line `min-height: 100%`).
2. **N2** — msg-header dividers at 1.03:1 (remove the 35% alpha; the palette lift already paid for this).
3. **N7** — finish the pressed-state family (7 files, one-line each).
4. **N4** — one `--pi-panel-toolbar-padding` token to retire the 8 vs 10/12 split (and the 47px terminal orphan).
5. **N3** — decide the leading ramp (publish or convert; then guard it).
6. **N5/N6/N8** — minor edge/constant cleanups.

## Evidence
- Screenshots: `/tmp/roundb-c-phone-{boot,sessions,workspace,chat,new-session,qs-close,sheet,actions-row}.png`, `/tmp/roundb-c-phone-tool-{files,terminal,tasks,relays,updates,info}.png`, `/tmp/roundb-c-desk-{boot,sessions,workspace,new-session,files,settings,rail}.png`, `/tmp/roundb-c-768-new-session.png`.
- Scripts: `/tmp/roundb-c-{harness,verify,phone,phone2..6,panels2,chat,empty,emptyparent,desktop,desk2..4,settings,press2,press3,final,last}.mjs` (node, cwd = repo root, playwright from repo node_modules).
