# Round D — Lane C: token & pattern layer (verification of dc41e086 + hunt)

Config: live stack http://localhost:8505/, branch `refactor/plugin-architecture` @ 48c97fd6 (fix wave under test: dc41e086).
Playwright chromium; phone 393x850 (hasTouch, isMobile), desktop 1280x850, mid 768x850. All numbers from computed styles /
bounding rects / live CSSOM via evaluate (shadow-DOM piercing). Screenshots: /tmp/roundd/*.png. Probe scripts: /tmp/roundd-*.js.
Guard suites re-run before browsing: **55/55 pass** (spacingScale, typeScale, radiusScale, controlHeightScale, dotScale,
boxModelGuard, tokenReferences, designTokens).

---

## 1. Round C fix wave (dc41e086) — reader-level verification: 4 of 7 claims reached, 3 did not

| # | dc41e086 claim | Verdict | Live evidence |
|---|---|---|---|
| 1 | empty-session box-sizing + centering | **REACHED** | 393/768/1280: scroller `scrollHeight == clientHeight` (610/610, 610/610, 610/610) — no fake scroll; `.empty-session` fills the `.chat` content box exactly (393: es [6,73 381x569.8] in scroller [0,49 393x609.8]; 73−49=24=pad-top, bottom gap 16=pad-bottom) (`ChatView.ts:368`) |
| 2 | tasks viewer flex + centered empty state | **NOT REACHED — D-TRUE-1** | see §2.1 |
| 3 | solid muted msg-header dividers | **REACHED** | live `border-bottom: 1px solid rgb(38,44,53)` on `.msg.user/.assistant/.system/.group-msg > .msg-header` (= `--pi-border-muted`, no 35% alpha left) (`ChatView.ts:379-388`); AskUserCard solid by source (`AskUserCard.ts:496`), client core served from source |
| 4 | compact pressed-state family un-nested | **REACHED** | live CSSOM: media rule at sheet root (`AppNavigationPanel.ts:466`); mid-press computed bg `rgb(27,32,39)` = `--pi-surface-hover` on `.compact-scope`, `.compact-fold`, and the expanded actions-row buttons |
| 5 | session-row pressed state | **REACHED** | session-list `.action-main` mid-press → `rgb(27,32,39)` (`SessionList.ts:818`) |
| 6 | drawer-control pressed state | **NOT REACHED — D-TRUE-2** | see §2.2 |
| 7 | goals-refresh + palette pressed states | **NOT REACHED — D-TRUE-2/3** | see §2.2/§2.3 |

Also verified from the same wave: **context-bar breathing** — bar 49px = 44 control + 2 top + 2 bottom + 1 border on phone and
desktop (phone: `.panel-toggle` [6,2 44x44] in bar [0,0 393x49]; desktop bar [341,0 938x49], pad `2px 6px`) (`AppContextBar.ts:72`).
**Contributed-section inset** — `.contributed-sections` padding-inline live: `0px 10px` phone / `0px 16px` desktop =
`--pi-reading-edge` per breakpoint (`AppNavigationPanel.ts:440`); goal rows are full-bleed inside it, so they land on the same
reading edge as native sections. (No goals data exists on this stack — the section never renders here; verified wrapper +
construction. The goals dist bundle is stale, see §2.3.)

## 2. New TRUE findings (3)

### D-TRUE-1 — The tasks empty-state fix is not on the reader's screen: the plugin bundle predates the commit that fixed it.
- Owning style: `pi-web-plugins/workspace-tasks/tasksPanelElement.ts:288` — dc41e086 changed `.tasks-viewer` to `align-content: stretch` (source is correct).
- Live reality: the API server serves `dist/pi-web-plugins/workspace-tasks/tasksPanelElement.js`, built **Sep 11 09:32** — five minutes **before** dc41e086 (09:37). It still carries `align-content: start`; curl of `http://localhost:8505/pi-web-plugins/workspace-tasks/tasksPanelElement.js` returns `align-content: start`. Live computed on the viewer: `display: grid / align-content: start`.
- Measured: desktop 1280 — viewer [870.4,86 409.6x764], empty-state [882.4,**98** 385.6x80.8]: **12 below / 671.3 above-bottom**. Phone 393 — viewer [0,114 393x736], empty-state [12,**126** 369x80.8]: **12 / 643.3**. Top-anchored at both widths — the exact Round C TRUE-1 signature.
- Sibling control: relays (fixed in the earlier wave, included in the 09:32 build) IS live and centers: `grid/stretch`, 341.6/341.6 desktop, 319.5/319.5 phone (`relaysPanelElement.ts:515`).
- Screenshots: /tmp/roundd/tasks-1280.png, /tmp/roundd/tasks-393.png, /tmp/roundd/relays-1280.png, /tmp/roundd/relays-393.png.
- Adjudication: **TRUE** — a recorded-as-fixed item the reader cannot see. One-line class of fix: rebuild the plugin bundles (`dist/pi-web-plugins/*`), no source change needed.

### D-TRUE-2 — drawer-control pressed state: the media query was nested inside `:focus-visible{}`, compiles to a selector that matches nothing.
- Owning style: `src/client/src/components/ChatView.ts:176-177` — `.drawer-control:focus-visible { …; @media (pointer: coarse) { .drawer-control:active { … } } }`.
- Live CSSOM (chat-view adopted sheet, mounted session): the rule serializes as `"& .drawer-control:active"` with `parentKind: CSSStyleRule`, `parentSel: ".drawer-control:focus-visible"` — the browser itself resolved the implicit descendant combinator. Matching requires the pressed control to be a *descendant* of a `:focus-visible` control — impossible for the same element.
- Controlled lab (identical pattern, `pointer: coarse`, real CDP press-and-hold): pressed background stays `rgba(0,0,0,0)`; the un-nested control paints `rgb(27,32,39)` (/tmp/roundd-nesting-lab2.js).
- Compared elements: `.drawer-collapse` (the only `.drawer-control` producer) vs the compact-header family that received the identical fix correctly one file earlier.
- Note: no drawer mounts in any current session on this stack (no sections with content), so the dead rule ships silently the moment one does.
- Adjudication: **TRUE**. Fix: hoist the media query out of the declaration block, exactly as dc41e086 already did for AppNavigationPanel.ts:466.

### D-TRUE-3 — goals-refresh and action-palette pressed states: same nested pattern, dead (and the goals rule isn't even served).
- Goals: `pi-web-plugins/goals/goalsSectionElement.ts:23` — `.refresh:active` nested inside `.refresh { … }` inside the media. Live CSSOM of the real element's sheet: the coarse media contains only `.refresh` (size bump) and `.refresh:hover` — the nested rule was **dropped at parse** (`childRules: []`). Live press on the real control (element mounted with real state): `matches(':active') === true`, computed background `rgba(0,0,0,0)` — pressed, nothing paints. Compounding: `dist/pi-web-plugins/goals/goalsSectionElement.js` (09:32) predates dc41e086, so today's bundle has no `:active` rule at all — and rebuilding would ship the dead one.
- Palette: `src/client/src/components/ActionPalette.ts:109` — coarse media nested inside `button { … }`. Live press on the real close button: `:active === true`, bg `rgba(0,0,0,0)` (surface-hover would be `rgb(27,32,39)`). The 35 option rows paint selection-bg on tap — but via `@focus → selectedIndex → .selected` (`ActionPalette.ts:50,114`), not via the pressed rule, which is dead everywhere in the sheet; the close control is the one with zero press feedback.
- Screenshots: /tmp/roundd/phone-goals-press.png, /tmp/roundd/phone-palette-close-press.png.
- Adjudication: **TRUE** (two producers, one bug class). Fix: hoist both media queries to sheet level — the same one-line un-nesting dc41e086 already applied to AppNavigationPanel.

## 3. Token/pattern layer audit

- **Computed spacing sweep** (all visible elements, all shadow roots; states: projects / sessions / new-session; 393, 768, 1280): **zero off-scale paddings/gaps/margins**. The only flags: the UA 14px `<p>` margins in main `.empty` (see below), the sticky msg-header `-12px` top margin (= `calc(-1 * var(--pi-space-6))`, token-derived, structural), and a visually-hidden input's ±2px offsets (screen-reader-only). The spacingScale guard (all .ts style sources, client + plugins) holds.
- **Computed type sweep**: one new off-scale value — **D-TRUE-4 (minor)**: `<small>` inside `.custom-card-unknown` computes **11.6667px** (UA `smaller` of the 14px base) — on no scale step (scale: 11/12/13/14/15/17/20). Owner: `ChatView.ts:1719` renders a bare `<small>`; `.custom-card` / `.custom-card-unknown` (`ChatView.ts:281-282`) have no `small` reset. The typeScale guard cannot see it (no literal — UA default). Round C's type sweep missed it because it needs a system message carrying an unregistered custom part. Measured: 3 instances in the live "pi web" session (`/tmp/roundd/small-hunt.png`). Adjudication: **TRUE, minor** (0.67px from the 11px step, but it is exactly the "size on no scale" class the guard exists for) — one `font-size: var(--pi-text-2xs)` on `.custom-card small` closes it.
- **Radius sweep**: zero off-scale computed radii. Live pill/round inventory unchanged: state dots (dot motif) and `row-tag`/`tool-badge` stamps only; every interactive control measured 0–3px (compact header controls 2px via `--pi-header-control-radius`, defined at `AppNavigationPanel.ts:451`). The phone fold button: radius 2px, 2px top / 2px bottom breathing in the 49px header — stays closed.
- **Borders that vanish**: computed sweep found **zero** sub-0.5-alpha borders on any visible element at any width — the 35%-alpha msg-header/AskUserCard dividers are fully gone from the reader's screen (TRUE-2 of Round C closed).
- **Palette hygiene (FALSE as defect)**: `goalsSectionElement.ts:18-19` carry off-palette fallback hexes — `var(--pi-danger, #c0392b)`, `var(--pi-success, #2e7d32)` (palette: `#ff7b72` / `#3fb950`). Fallbacks can never paint (tokens are published on `:root` and inherit through shadow roots), but they are off-palette values waiting for a theme that omits the tokens. Same one-line class as the Round C `p { margin: 0 }` note.
- **Un-owned value note (FALSE as defect)**: main `.empty` still renders a bare `<p>` with UA 14px margins (`PiWebApp.ts`, unchanged by dc41e086) — symmetric (31/31 inside the card; card center 449.55 vs main center 449.5 — centered), same status as Round C: the one-line `p { margin: 0 }` closure is still pending.
- **Chat vertical rhythm note (FALSE as defect)**: `.chat` pads `var(--pi-space-9) var(--pi-chat-gutter) var(--pi-space-7)` = 24 top / 16 bottom (`ChatView.ts:206`) — both on-scale, asymmetry structural: the 24-top pairs with `--pi-chat-sticky-top: calc(-1 * var(--pi-space-9))` for the sticky-header arc. Consequence: the new-session content center sits **+4px below the scroller-box center at every width** (measured 393/768/1280: gaps 264.4/256.4, 264.4/256.4, 273.1/265.2). Token-owned and deliberate — recorded so no lane re-hunts it.

## 4. Owner's four complaints — re-measured

1. **Alignment**: FALSE (clean) within columns — desktop rail: header x=16 = h2 x=16 = tiles x=16 = tool-rows x=16; phone: compact-header pad 10, sessions h2 x=10, rows x=10, tool-rows x=10; chat gutter 6 (phone) / 16 (desktop). The session row's inner 3px offset (btn x=13 on a row at x=10) is the `--pi-rail-width: 3px` transparent state rail (`shared.ts:413`) — token-owned. Cross-column nav-10/chat-6/desktop-16 remains ledger-deferred, unchanged.
2. **Whitespace rhythm**: phone sessions heading row gaps 25.9/25.9/25.9 uniform; desktop 9.6/9.5/9.6 uniform — the recorded touch-density deferral, numbers unchanged. Sweep found no new loose/tight value.
3. **Button boundaries**: FALSE (clean, unchanged) — settings nav tabs 1px (selected: accent border + selection bg), tool rows and compact actions `1px solid var(--pi-border)`, composer icon-buttons are the deliberate borderless glyph family with hover/pressed surface steps.
4. **Fold button**: stays closed — [339,2 44x44] in the 49px compact header (2/2 breathing), radius 2px, square in the radius language; desktop headers run their controls flush across all three (rail/drawer/workspace) — consistent density language.

## 5. NEW hunt — "New session" centering, every surface, 393/768/1280

| Surface | Result |
|---|---|
| Chat empty-session 393 / 768 / 1280 | **centered** (content in card dead-center; +4px scroller-relative, token-owned padding, §3) — REACHED |
| Desktop main `.empty` ("Select a project…") | **centered** (449.55 vs 449.5) — UA 14px p note stands (FALSE) |
| Relays empty state 393 / 1280 | **centered** (319.5/319.5, 341.6/341.6) |
| Tasks empty state 393 / 1280 | **top-anchored — the one failure (D-TRUE-1, stale bundle)** |
| Tasks "Select a workspace." hint (`tasksPanelElement.ts:69`) | top hint bar by design — not a centering case |
| Responsive | no fake scroll at any width; `.empty-session` fills the `.chat` content box exactly; heading rows uniform at all widths |

## 6. Ledger cross-check

- Phone heading rhythm 25.9 vs desktop 9.6 — unchanged (deferred).
- Section padding systems nav 10 / chat 6 / desktop 16 — unchanged (deferred).
- Settings panel indent 13px — not re-derivable this round without the Appearance surface open; dc41e086 touched nothing in settings.
- Pill badges — held at badge-only (deferred, accurate).
- Context-bar ☰ vertical flush — **closed by dc41e086 and verified live this round** (49px bar, 2/2 breathing); the ledger should move it from Round B lane A's TRUE to fixed.
- New this round, not deferrals: D-TRUE-1 (stale plugin bundle — delivery failure, fix = rebuild), D-TRUE-2/3 (three dead pressed-state rules — fix = hoist media queries), D-TRUE-4 (off-scale UA small — fix = one font-size rule).

## 7. Bottom line

Round C's four fixes: three verified at the reader (empty-session scroll/centering, solid dividers, compact un-nesting + the
context-bar/contributed-inset companions). The tasks viewer fix is correct in source but **was built five minutes before it was
committed** — the served bundle still has the bug. The pressed-state family gained three members whose rules match nothing (the
exact bug class the commit fixed in AppNavigationPanel, re-typed into ChatView, ActionPalette and goals in the same commit).
Token discipline otherwise holds everywhere: zero off-scale spacing/radius at computed level, one off-scale UA-default type size,
no vanishing borders left. **The bar (zero new TRUEs) is not met: 4 new TRUEs, all one-line classes of fix — rebuild the plugin
dist; hoist three media queries; one font-size rule.**

Screenshots: /tmp/roundd/ (phone-sessions-state, phone-fold-open, phone-fold-pressed, phone-actionsrow-pressed, phone-chat-hu,
phone-chat-big, phone-goals-press, phone-palette-close-press, phone-new-session, empty-fresh-393/768/1280, desktop-projects,
desktop-session, desktop-settings-buttons, tasks-1280, tasks-393, relays-1280, relays-393, small-hunt).
