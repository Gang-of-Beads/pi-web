# Round F — Lane C: token & pattern layer (verification of the Round E fix wave + clean sweep)

Config: live stack http://localhost:8505/, branch `refactor/plugin-architecture` @ 387ad48f (fix wave under test: **b2f826b5**). Playwright chromium; phone 393×850 (hasTouch, isMobile, dpr2), desktop 1280×850, mid 768×850. Every number below is from computed styles / bounding rects / live CSSOM via evaluate (shadow-DOM pierced by walking `pi-web-app` shadow roots). Probe scripts: /tmp/roundf-*.js; screenshots: /tmp/roundf-*.png; sweep flags: /tmp/roundf-sweep-flags.json + /tmp/roundf-phone-flags.json. No repo files modified; stack not restarted.

**Guard suites re-run at HEAD: 55/55 pass** (spacingScale, typeScale, radiusScale, controlHeightScale, dotScale, boxModelGuard, tokenReferences, designTokens — vitest, 8 files). Published scales read from `src/client/index.html`: space 2–24 (2px steps, 9 tokens), type 11/12/13/14/15/17/20, leading tokens tight 1.25 / normal 1.45, radius 0/1/2/3/4 (+pill 999), plus the published control reservation `--pi-control-font-size: 16px` (index.html:143).

---

## 1. Round E fix-wave verification

### 1.1 Goals refresh hover regression (extra brace removed) — VERIFIED at the reader
- Owning style: `pi-web-plugins/goals/goalsSectionElement.ts:23-24` — the stray `}` is gone; line 23 ends the coarse media block correctly and line 24 is a sibling top-level rule.
- Live CSSOM (desktop, goals section mounted on a session): `media((hover: hover)) > .refresh:hover { color: var(--pi-text); background: var(--pi-surface-hover); }` parses as a **top-level media rule** (17 rules total in the sheet, no swallowing).
- Real-pointer measurement (1280×850, refresh 32×32 @ (292,589.5)): resting `background: rgba(0,0,0,0)`, `color: rgb(139,145,155)` → hover `matches(':hover') === true`, `background: rgb(27,32,39)` (= --pi-surface-hover), `color: rgb(230,232,236)` (= --pi-text).
- Screenshot: /tmp/roundf-goals-hover.png. **PASS.**

### 1.2 Bare-small family → `--pi-text-2xs` (11px floor) — VERIFIED, 3 of 4 producers live-measured, 4th CSSOM-verified
| Producer | Owning rule (all in b2f826b5) | Live computed |
|---|---|---|
| Palette option descriptions | `ActionPalette.ts:122` (`small { … font-size: var(--pi-text-2xs) … }`) + intended `:115` | **11px** on all 6 mounted options (was 11.6667px) |
| Autocomplete "/" descriptions | `AutocompleteMenu.ts:14` | **11px** on 8 live rows (was 10px) |
| Shared list footers (session-list "N messages", Updates "running 1.202609.18 · installed 1.202609.18 · pi 0.85.0", "checked …", Info path line) | `shared.ts:172` (`small, .muted { color: …; font-size: var(--pi-text-2xs); }`) | **11px** on all visible smalls across session-list + updates + info panels (was 10.83px) |
| ChatView custom-card fallback | `ChatView.ts:283` (`.custom-card-unknown small, .part > small { font-size: var(--pi-text-2xs); }`) | rule present at **CSSOM top level** in the live chat-view sheet (not nested), template balance 0; cannot be produced live without an unknown-part message — CSSOM + balanced source is the evidence |
- Screenshots: /tmp/roundf-autocomplete.png, /tmp/roundf-updates-smalls.png, /tmp/roundf-info-smalls.png. **PASS** — with one structural caveat: for the palette the 11px reaches the reader **only through the accident documented in F-1 below** (the intended `:115` rule is dead; the bottom `:122` rule survives nesting because `& small` still matches). If `:122` ever loses its font-size, the palette silently reverts.

---

## 2. NEW TRUE — F-1: the fix wave re-introduced its own bug class in the action palette (missing closing brace → native CSS nesting swallows the option rules)

- **Owning style**: `src/client/src/components/ActionPalette.ts:114` — the `.options button { … }` rule **lost its closing `}`** when the small rule was inserted at :115 (visible in the b2f826b5 diff: `…text-align: left; }` became `…text-align: left;` + new line). Template brace balance of the file's style template: **+1** (verified by scan; every other component template balances at 0).
- **What the reader's browser does** (live CSSOM dump of `action-palette` adoptedStyleSheets, desktop 1280): the sheet has **14 top-level rules and ends at `.options button {`** — every following rule is parsed as **nested** under it (`& .options button small`, `& .options button.selected`, `media((hover:hover)) & .options button:hover:not(:disabled)`, `& .options button:disabled`, `& .options button.disabled.selected`, `& .main`, `& strong`, `& small`, `& .disabled-reason`, `& .group`, `& kbd`, `& .empty`, `media((pointer:coarse)) & kbd/…`).
- **Measured casualties at the reader** (1280 desktop, fine pointer, palette opened via the nav "Actions" button):
  - **Selected highlight DEAD**: the `.selected` option computes `background: rgba(0, 0, 0, 0)` — the element matches `.options button.selected` directly (`true`) but not the nested form `:is(.options button) .options button.selected` (`false`). The keyboard-selected row in the command palette has **no visible selection** — the palette is keyboard-first, so this is its primary affordance.
  - **Hover highlight DEAD** (desktop): real mouse over an unselected option → `matches(':hover')` true, computed `background: rgba(0, 0, 0, 0)`.
  - **Disabled dimming DEAD**: `& .options button:disabled { cursor: not-allowed; opacity: var(--pi-disabled-opacity) }` can never match (no button nests inside a button). No disabled options were mounted live; rule-level evidence.
  - **Empty state unstyled**: force-typed "zzzqqq" → "No actions found." computes `padding: 0px`, `text-align: start` (source intends `--pi-space-9` 24px + centered). `matches(':is(.options button) .empty')` → false.
  - Accidentally **alive** via nesting (small/`.main`/`strong`/`kbd`/`.group`/`.disabled-reason` are descendants of the button, so `& X` matches): the **11px small fix lands** (§1.2), kbd chips stay hidden on coarse, option layout intact.
- **Adjudication: TRUE (new)** — a regression introduced by the very wave under test, same bug class as the goals extra brace b2f826b5 fixes (its own commit message names the class). Fix is one character: restore the `}` at `ActionPalette.ts:114`. The typeScale/spacing/radius guards cannot see it (no off-scale literal; the imbalance is parser-level), which is exactly why it shipped through a 55/55 guard run.
- Screenshots: /tmp/roundf-palette-open.png (palette open, CSSOM state), /tmp/roundf-palette-selected.png (selected row without highlight), /tmp/roundf-palette-empty.png ("No actions found." unstyled).

---

## 3. Carried-unfixed (not new, not in the ledger) — T-E1 from Round E lane A: menu-panel items still have no coarse pressed state

- Source at HEAD: `shared.ts:489-493` — `.action-menu-panel button { … border: 0; background: transparent … }` + hover-only `:490` + coarse block `:493` giving min-height only. Same for `QuickSwitcher.ts:521-523` (`.row-menu button` hover-only; coarse min-height only). No `:active` rule anywhere in either block.
- Live re-measure (393 phone, real mouse down-hold ≥400ms on a project-tile menu item "Close", 165×44-class): mid-press `matches(':active') === true`, computed `background: rgba(0, 0, 0, 0)` — **no pressed feedback**. Screenshot: /tmp/roundf-menuitem-press.png.
- Status: Round E lane A adjudicated this TRUE (P1) and the b2f826b5 wave did not include it; it is not in the round-b ledger either. **Carried-unfixed TRUE** — if the owner counts carried items inside the bar (as Round E's lane C asked), the loop continues on this in addition to F-1.

---

## 4. Token/pattern sweep — 30 states × 393/768/1280, computed level

States swept per width: boot, context step/sheet, sessions, chat (live session), all six tool panels (Files/Terminal/Tasks/Relays/Updates/Info), quick switcher, action palette, settings dialog (~70–720 elements/state, deduped flags in /tmp/roundf-sweep-flags.json). Flagger: computed padding/margin/gap outside the published space set, font-size outside 11–20 scale, radius outside 0–4/999, border alpha 0.02–0.5, line-height ratio outside 1.0–1.6 steps.

**Zero un-owned spacing. Zero off-scale radii. Zero vanishing (sub-0.5-alpha) borders.** Every flagged value resolves to a token, a token calc, or a documented mechanism:

| Flag (deduped) | Resolution | Adjudication |
|---|---|---|
| All search/dialog inputs + prompt editor at **16px** (`project-list`, `session-list`, `quick-switcher`, `action-palette`, `settings-general-panel`, prompt-editor cm-* family) | published token `--pi-control-font-size: 16px` (`index.html:143`) — the iOS-zoom control reservation | FALSE (on a published token) |
| `project-list>button.action-main` pad **10px 56px / 54px** | `shared.ts:305` = `calc(--pi-tile-menu-inset + --pi-tile-menu-size + --pi-space-2 + --pi-dot-md + --pi-space-2)`; per-pointer values via `shared.ts:331/338` | FALSE (token math, menu-safe reservation) |
| `quick-switcher>button.row` pad **10px 48px** | `QuickSwitcher.ts:429` base 10/12 + `:487` `padding-right: calc(var(--qs-menu-size) + var(--pi-space-2))` (36/44 + 12/4 → 48 both pointers) | FALSE (token calc) |
| prompt-editor `.cm-content` pad **8px 58px / 44px** | documented structural reservations (`PromptEditor.ts:170,172`) — unchanged status since Round D | FALSE (documented) |
| `modal-surface>div.backdrop` pad **90px 20px 20px** | `ActionPalette.ts:103` `--palette-top: min(12dvh, 90px)` floating-palette channel | FALSE (documented) |
| `pi-files-panel>div.toolbar-actions` margin-left **191.9–225.9px** | computed from `margin-left: auto` (`filesPanelElement.ts:500`) — push-right mechanism | FALSE (mechanism) |
| `pi-web-app>div.empty` margin **352/360.75px …** | `margin: auto` centering (Round B mechanism fix) | FALSE (mechanism) |
| `pi-files-panel>input.visually-hidden` **13.33px** | screen-reader-only, not rendered | FALSE |
| `chat-view>span.msg-meta` **font-size 0px** | `ChatView.ts:426` — deliberate collapsed-meta pattern: 24×24 hit target (`--pi-dot`-scale size), text revealed on hover/focus/expand (`:419-420`) | FALSE (mechanism, deliberate) |
| `terminal-panel>button.new` / tabs **line-height 1.33 (16px/12px)** | `TerminalPanel.ts:732` `line-height: 16px` — a **px leading literal** | FALSE as new item — member of the **ledgered E-2 class** (px-literal variant; the ramp item now carried per this round's brief) |

- E-2 (leading ramp) otherwise unchanged from Round E lane C's byte-count: literals at 1.2/1.25/1.3/1.35/1.4/1.45/1.5 + `normal` + the terminal's 16px — one decision (publish the steps or convert) + one guard line closes the class.
- Radius language holds: the only `--pi-radius-pill` consumers remain badges/stamps (`.drawer-tab-badge`, `.row-tag`, dots); every interactive control measured 0–3px. The circle-among-squares complaint stays closed.

---

## 5. Owner's four complaints — re-measured, all closed or at ledger numbers

1. **Alignment — FALSE (clean within columns)**: phone nav single reading edge **x=10** — h2 Projects 10..383, search input 10..383, tile grid 10..383, scope chip 10.., sessions h2 10..383, session search 10..383; right edge **383** uniform (h2 = search = row = +New session CTA 267.3..383). Desktop rail single edge **x=16** — h2-sessions 16..324, search 16..324, CTA right **324** = h2 right. Row optical inset (rows at 13 phone / 19 desktop inside the grid) unchanged, Round A-adjudicated. Cross-column nav-10/chat-6/desktop-16 remains the ledger-deferred contract.
2. **Whitespace rhythm — FALSE (ledger numbers unchanged)**: sessions heading row gap [Clean up → +New session] phone **25.9** / desktop **9.6** (and 768 = 9.6, desktop rail family) — exactly the Round B/E deferred touch-density pair, uniform distribution. No new loose or tight value anywhere in the 30-state sweep (the only large pads are the token calc / reservations in §4).
3. **Button boundaries — FALSE (closed)**: zero sub-0.5-alpha borders in any swept state; fold button carries `1px rgb(58,66,78)` border on `rgb(19,22,27)` raised surface (measured, §5.4); settings dialog sweep at 768/1280 (347/658 elements) — no alpha borders, no off-scale radii; Round E's settings numbers (secondary 1px surface border, primary accent + fill, radius 2px) unchanged.
4. **Fold button — FALSE (closed)**: `.compact-fold` **44×44 @ (339,2)** inside the 49px compact-header, **radius 2px** (square language), border `1px rgb(58,66,78)`, bg `rgb(19,22,27)`, breathing **top 2 / bottom 3** (2px pad + 1px border) — identical to the Round B–E closed numbers; no circle among squares. Screenshot: /tmp/roundf-phone-fold.png.

## 6. NEW hunt — "New session" centering (re-verified, stays green)

| Width | Empty-session box | Content centering | Scroller |
|---|---|---|---|
| 393 phone | 381×525 @ (6,118) | **217.9 above / 217.9 below** — dead center | scrollHeight 565 = clientHeight 565, scrollTop 0 — no fake scroll |
| 768 | 395×525 @ (−1,118) | **217.9 / 217.9** | 565 = 565 |
| 1280 | 496×525 @ (357,118) | **226.6 / 226.7** (0.1px) | 565 = 565 |

Identical to the Round D/E closed mechanism (`min-height: 100%` + auto margins). Screenshots: /tmp/roundf-phone-newsession.png, /tmp/roundf-mid-newsession.png, /tmp/roundf-desk-newsession.png.

## 7. Ledger cross-check

- Deferred at unchanged numbers: heading rhythm 25.9/9.6 (§5.2), section padding systems nav-10/chat-6/desktop-16 (§5.1), settings indent 13px / title edges / Save below fold / workspace panel edges / create-button forms / pill badges — not contradicted by any sweep state.
- E-2 leading ramp: now carried per this round's brief; one new family member recorded (terminal 16px px-literal, §4) — no change in disposition.
- T-E1 (menu-item pressed states): **not in the ledger and still open** (§3) — carried-unfixed.
- **New TRUE beyond the ledger: F-1 only** (§2) — the loop continues on one missing brace.

## 8. Bottom line

Both Round E fix items genuinely reach the reader (goals hover live-measured ALIVE; the 11px small floor live-measured at three producers and CSSOM-verified at the fourth), the token layer is otherwise clean at computed level across 30 states and three widths, and the four complaints plus the New-session hunt all hold their closed numbers. But **b2f826b5 reintroduced its own bug class in ActionPalette.ts**: one missing `}` (:114) collapses every rule after `.options button` into dead nested selectors — the command palette's selected-row highlight, hover highlight, disabled dimming and empty-state styling are measurably gone (§2). One character closes it. Separately, Round E lane A's T-E1 remains carried-unfixed and unledgered (§3).

Probe side effects (disclosed): three new empty sessions created (New-session CTA clicks at 393/768/1280); one click on a row-menu item labelled "Close" in a project tile menu while probing T-E1 pressed state (project list verified intact afterward); sessions/tool panels/palette/quick-switcher/settings opened and closed through their UI affordances; no session content written, no live coordination session touched, no repo files modified, stack not restarted.

Screenshots: /tmp/roundf-goals-hover.png, roundf-palette-open.png, roundf-palette-selected.png, roundf-palette-empty.png, roundf-autocomplete.png, roundf-updates-smalls.png, roundf-info-smalls.png, roundf-phone-fold.png, roundf-menuitem-press.png, roundf-phone-boot.png, roundf-phone-chat.png, roundf-phone-sessions-head.png, roundf-phone/mid/desk-newsession.png, roundf-sweep-{393,768,1280}-settings.png.
Scripts: /tmp/roundf-*.js (recon, palette-deep, smalls, producers, sweep2, final, fold, headrow, te1, bisect). Sweep flags: /tmp/roundf-sweep-flags.json, /tmp/roundf-phone-flags.json.
