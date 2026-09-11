# Round E — Lane C: token & pattern layer (FINAL delivery verification)

Config: live stack http://localhost:8505/, branch `refactor/plugin-architecture` @ 32560596 (fix waves under test: 9fd3f926 + 8c42e2f0). Playwright chromium; phone 393×850 (hasTouch, isMobile), desktop 1280×850, mid 768×850. All numbers from computed styles / bounding rects / served bytes via evaluate (shadow-DOM piercing). Screenshots: /tmp/rounde-shots/. Probe scripts: /tmp/rounde-*.js. No repo files modified; stack not restarted.

Guard suites re-run before browsing: **55/55 pass** (spacingScale, typeScale, radiusScale, controlHeightScale, dotScale, boxModelGuard, tokenReferences, designTokens).

**Delivery check (sha-grade, learned in Round D):** `dist/pi-web-plugins/*` rebuilt 10:44 — the served bytes carry the fix content: `curl :8505/pi-web-plugins/workspace-tasks/tasksPanelElement.js` → `align-content: stretch`; `curl :8505/pi-web-plugins/goals/goalsSectionElement.js` → `@media (pointer: coarse) { .refresh { …44px; } .refresh:active { background: var(--pi-surface-hover); } }` (hoisted). Client components (ChatView, ActionPalette, shared.ts, AppNavigationPanel) serve from Vite source (the `/@fs/` URL returns 200 and the live CSSOM matches source). Note for the record: the dist mtime (10:44) still *predates* the commit timestamps (10:49/10:51) — content is correct this time, but the pipeline order that burned Round D is unchanged; only the content check makes this safe.

---

## 1. Round E verification — all five items + the two carried pressed-state fixes: VERIFIED LIVE

### 1.1 Tasks viewer empty state centers — VERIFIED (D-TRUE-1 closed at the reader)
- Owning style: `pi-web-plugins/workspace-tasks/tasksPanelElement.ts:288` — `.tasks-viewer { display: grid; align-content: stretch; gap: var(--pi-space-6); }`, served from dist (curl-verified, §delivery).
- Live desktop 1280: viewer [y=86, h=764], `display: grid`, `align-content: stretch`; the true empty-state (`.empty-state` "No workspace tasks configured here…") sits **341.6 above / 341.6 below** — dead center.
- Live phone 393: viewer [0,179 393×671] pad 12, content (error status variant, "Could not load workspace tasks…") **12 above / 12 below**.
- Screenshots: /tmp/rounde-shots/desktop-tasks-open.png, phone-tasks-open.png. Relays re-checked in the same passes (sweep clean; still centers per Round D mechanism, `relaysPanelElement.ts:515`).

### 1.2 Goals refresh pressed state live — VERIFIED (D-TRUE-3 goals half closed at the reader)
- Owning style: `pi-web-plugins/goals/goalsSectionElement.ts:23` (media query hoisted; served from dist, §delivery).
- Live: goals drawer section mounted ("Goals 1" tab, workspace `/private/tmp/test` with a live goal record); `.refresh` 44×44 (touch floor), radius 1px (`--pi-radius-sm`); real pointer press-and-hold → **`background: rgb(27,32,39)` = `--pi-surface-hover`, `:active` matches**.
- Right edge: x=343..387 — right inset 6 = the chat gutter (`--pi-chat-gutter` phone) — consistent within the chat column (Round B's flush-to-screen-edge N6 is gone).
- Screenshot: /tmp/rounde-shots/press-goals-refresh.png (drawer context: phone-drawer-open-goals.png).

### 1.3 Shared list rows pressed state, nav panel AND context sheet — VERIFIED (T-D3 closed at the reader)
- Owning style: `src/client/src/components/shared.ts:253` — `@media (pointer: coarse) { .action-row .action-main:active { background: var(--pi-surface-hover); } }` (served from source; live CSSOM carries it).
- Measured mid-press with real pointer, each paints `rgb(27,32,39)` and matches `:active`:

| Producer | Surface | Pressed bg |
|---|---|---|
| `project-list .action-main` | nav panel (phone) | **rgb(27,32,39)** ✓ |
| `project-list .action-main` | context sheet | **rgb(27,32,39)** ✓ |
| `workspace-list .action-main` | nav panel + sheet | **rgb(27,32,39)** ✓ |
| `machine-list .action-main` | context sheet ("prod-8504" row) | **rgb(27,32,39)** ✓ |
| `session-list .action-main` | nav panel (own shadow rule, `SessionList.ts:818`) | **rgb(27,32,39)** ✓ |

- Note: on this stack's phone/desktop layouts the nav panel renders machines as scope chips/tabs; the machine-list *row* producer mounts only in the sheet — the shared rule covers it there, which is where it renders.
- Screenshots: /tmp/rounde-shots/press-nav-project.png, press-sheet-project.png, press-sheet-workspace.png, press-sheet-machine.png, press-nav-session.png.

### 1.4 Rail header breathing symmetric with the context bar — VERIFIED (D3 closed at the reader)
- Owning style: `src/client/src/components/appShell/AppNavigationPanel.ts:441` — `header { … padding: var(--pi-space-1) var(--pi-reading-edge); }`; `AppContextBar.ts:72` — `padding: var(--pi-space-1) var(--pi-chrome-inset)`.
- Live desktop 1280, the two 44px-control header rows across the divider:

| Row | Height | Vertical pad | Control insets |
|---|---|---|---|
| Rail header (`app-navigation-panel header`) | **49px** | 2px 16px | icon & buttons: top **2** / bottom **3** (2 + 1px border) |
| Context bar (`app-context-bar .context-bar`) | **49px** | 2px 6px | `.panel-toggle` & title: top **2** / bottom **3** (2 + 1px border) |

- Identical breathing, identical 1px `rgb(58,66,78)` bottom border — symmetric across the divider. Phone compact header matches too (`.compact-header` 49px, pad 2px 10px, fold top 2 / bottom 3).

### 1.5 Queued-message divider solid — VERIFIED (D4 closed at the reader)
- Owning style: `src/client/src/components/ChatView.ts:289` — `.msg.user.queued > .msg-header { border-bottom-color: var(--pi-border-muted); … }`.
- Live: created a queued message (steer send while the test session streamed); `.msg.user.queued > .msg-header` computes **`border-bottom: 1px solid rgb(38,44,53)`** = solid `--pi-border-muted`, no alpha/color-mix left; warning surface (rgb(31,26,16)) and label (#d29922) intact.
- Screenshot: /tmp/rounde-shots/phone-queued-msg.png.

### 1.6 Carried pressed-state fixes from Round D — both VERIFIED LIVE
- **Drawer-control (D-TRUE-2)**: hoisted media (`ChatView.ts:176-177`) — pressed the real `.drawer-toggle` (`.drawer-control.drawer-collapse`) in the mounted Goals drawer: mid-press **rgb(27,32,39)**, `:active` matches (was: dead rule, transparent).
- **Action palette (D-TRUE-3)**: hoisted media (`ActionPalette.ts:109-110`, commit 8c42e2f0) — phone (coarse) press on the palette header close button: mid-press **rgb(27,32,39)**, `:active` matches; 44×44 touch size on phone, 36×36 on fine pointer (correct per-breakpoint).
- Screenshots: /tmp/rounde-shots/press-drawer-toggle.png, press-palette-close-phone.png.

---

## 2. Token/pattern sweep (computed, all shadow roots, states × widths)

States swept at 393 / 768 / 1280: projects boot, context sheet, sessions, chat (live session), all six tool panels (tasks/relays/files/terminal/updates/info), quick switcher/palette, settings dialog. Flags = computed padding/margin/gap/font-size/border-radius not on the published scales (space 2–24, text 11–20, radius 0–4/999) + any border with alpha 0.05–0.5.

**Zero un-owned spacing. Zero vanishing borders. Zero off-scale radii.** Every flagged value resolved to a token-derived calc or a documented reservation:

| Flag | Resolution |
|---|---|
| project tile `padding 56px` (one side) | `shared.ts:305` right pad = `calc(var(--pi-tile-menu-inset) + var(--pi-tile-menu-size) + var(--pi-space-2) + var(--pi-dot-md) + var(--pi-space-2))` = 4+36+4+8+4 = 56 on coarse — token math, menu-safe asymmetric inset |
| sheet header `padding 18px` | `ContextSwitcherSheet.ts:86` = `calc(var(--pi-space-4) + var(--pi-reading-edge))` = 8+10 phone — token math |
| composer `padding-right 44/58px` | the documented structural reservations (`PromptEditor.ts:95,106,131,170-172`) — unchanged status |
| `margin auto` computed px on `.empty`, `.toolbar-actions`, `.activity-elapsed` | centering mechanisms, not spacing |
| `font 13.33px` on `input.visually-hidden` | screen-reader-only, not rendered |
| backdrop `padding 90px` (quick switcher) | `ActionPalette.ts:103` `--palette-top: min(12dvh, 90px)` — floating-palette positioning channel with a clamp, not rhythm spacing |

**Radius language holds**: fold button 2px (measured, §1.4), all interactive controls 0–3px; the only `--pi-radius-pill` consumers remain badges/stamps (`.drawer-tab-badge`, `.stale`, `.row-tag`, dots) — no new pills; the circle-among-squares complaint stays closed.

**Border discipline**: no sub-0.5-alpha borders anywhere in any swept state — the 35%-alpha divider family is fully gone from the reader's screen.

**Button boundaries (complaint 3)**: settings dialog buttons re-measured — secondary `1px rgb(58,66,78)` on surface, primary/selected `1px rgb(88,166,255)` + selection bg, all radius 2px; unselected settings nav tabs carry a reserved `1px transparent` border (selected = accent + fill, no layout shift). FALSE (clean, unchanged). Screenshot: /tmp/rounde-shots/desk-settings-rounde.png.

---

## 3. Findings

### E-1 (TRUE — the one open class; carried from Round D, now measured at four producers) — bare `<small>` renders off-scale, and the D-TRUE-4 fix never landed
The bug class Round D adjudicated (D-TRUE-4: UA `small` computes off the type scale; fix = one `font-size` rule) is **still unfixed in source** (`ChatView.ts:281-282` has no `small` reset; `<small>` at :1719/:1738/:1952/:1959 still computes 11.6667px when an unregistered custom part renders). This round's sweep found **three more producers of the same class** that previous sweeps' states never reached:

| Producer | Owning rule | Live computed | Where measured |
|---|---|---|---|
| `ChatView.ts:281-282,1719` (custom-card small) | no reset (D-TRUE-4, unfixed) | 11.6667px (UA `smaller` of 14) | Round D; source unchanged |
| `ActionPalette.ts:121` — `small { display:block; color… }` no font-size | `ActionPalette.ts:55,56,59` | **11.6667px** | QS palette option descriptions/footers ("Move keyboard focus to the message composer") |
| `shared.ts:172` — `small, .muted { color: … }` color-only, host base 13px | feeds plugin footers | **10.8333px** (UA `smaller` of 13 — below the 11px floor) | Updates footer "running 1.202609.18 · installed …", Info footer path line (`pi-web-plugins/updates/pi-web-plugin.ts:26`) |
| `AutocompleteMenu.ts:14` — `small { grid-column… }` no font-size, inside 12px buttons | description row | **10px** (UA `smaller` of 12) | 12 live instances in the "/" command menu (measured live, items visible) |

- Scale floor is `--pi-text-2xs: 11px`; 10px and 10.83px sit below it, 11.67px between 11 and 12 — exactly the "size on no scale" class the typeScale guard structurally cannot see (no literal in source).
- Adjudication: **TRUE — one bug class, four producers, one line each** (`font-size: var(--pi-text-2xs)` — palette/menu descriptions and custom-card; the updates/info footer smalls close from `shared.ts:172` in one shot). Strictly: D-TRUE-4 itself is a *carried* Round D item (not new), but the three newly measured producers are new surface; if the owner counts the class as one open item the loop continues on exactly this.

### E-2 (TRUE — carried from Round B, unchanged; flagging so it isn't lost) — leading literals still bypass the published ramp
Round B N3 counted 44 `line-height` declarations at five off-ramp values. Re-counted today, byte-identical distribution: `1.4`×14, `1.3`×11, `1.35`×10, `1.2`×5, `1.5`×2, `normal`×2 (published ramp: `--pi-leading-tight: 1.25`, `--pi-leading-normal: 1.45`). Never fixed, never ledgered. One decision (publish the two extra steps or convert to the tokens) + one guard line closes it.

---

## 4. Owner's four complaints — re-measured, all stay closed

1. **Alignment**: clean within every column — phone reading edge x=10 (scope chip, h2, rows, tiles, search); desktop rail x=16 everywhere; heading row right edge = row right edge = CTA right edge (383/383/383 phone, 324/324/324 desktop). Cross-column nav-10/chat-6/desktop-16 remains the ledger-deferred contract, unchanged.
2. **Whitespace rhythm**: sessions heading row gaps phone **25.9/25.9/25.9** (computed gap 12), desktop **9.6/9.5/9.6** (gap 4) — uniform at both widths; numbers identical to Rounds B/D. The touch-density deferral stands; no new loose/tight value anywhere in the sweep.
3. **Button boundaries**: closed (§2 — every button carries a 1px token border or an accent fill; borderless family is only the composer glyph buttons with hover/press steps).
4. **Fold button**: [339,2 44×44] in the 49px compact header, **radius 2px**, breathing top 2 / bottom 3 (2 + 1px border) — same rhythm as the context bar and the desktop rail header; no circle among squares. Screenshot: /tmp/rounde-shots/phone-fold-check.png.

## 5. NEW hunt — "New session" centering, margins, responsive

- **Phone 393**: new-session empty state — the title+CTA cluster measures **240.4 above / 240.4 below** the chat content box: dead center (screenshot newsession-393.png). The `.empty-session` fills the scroller exactly (`min-height: 100%`, `scrollHeight == clientHeight` 610/610 — no fake scroll); the +4px scroller-relative offset is the token-owned 24/16 chat padding (recorded Round D, deliberate).
- **768 / 1280**: same mechanism; on this stack a machine-pending extension-updates dialog attaches below the empty state and the app auto-scrolls to it (scrollH 847 vs clientH 593 at 768) — the empty state itself stays centered relative to its own box; scroll state is dialog content, not a centering defect (screenshots newsession-768/1280.png).
- Desktop main `.empty` ("Select a project…") centered via `margin: auto` (computed margins equal both sides); the UA 14px `<p>` margins note stands (carried one-liner, FALSE as defect, symmetric).
- Responsive: no fake scroll at any width in a clean empty session; toolbars/tiles reflow on token steps (tile menu inset/size switch at coarse, `shared.ts:331/338`).
- Goals/tasks empty states: tasks centers (§1.1); relays centers; the sheet's word-headings keep the 4px rhythm (sweep clean).

## 6. Ledger cross-check

- Phone heading rhythm 25.9 vs 9.6 — unchanged (deferred, touch-density).
- Section padding systems nav 10 / chat 6 / desktop 16 — unchanged (deferred, per-column contract).
- Settings indent 13px / Save below fold / workspace panel edges / create-button forms / pill badges — not re-derived this round; nothing in the sweeps contradicts them.
- Context-bar ☰ vertical flush — stays closed (§1.4 numbers).
- Goals drawer row inset — closed (refresh at 387 = chat-gutter edge; §1.2).
- **Not in the ledger and still open**: E-1 (UA-small class, 4 producers — D-TRUE-4 carried + 3 new) and E-2 (leading literals, Round B N3 carried).

## 7. Bottom line

All five Round E verification items plus both carried pressed-state fixes are **live at the reader** — the Round D delivery failure is genuinely repaired and every pressed producer in the family now paints. Token discipline otherwise holds: zero un-owned spacing, zero vanishing borders, zero off-scale radii, at computed level, across every state and width. **The bar (zero new TRUE beyond the ledger) turns on one class**: the bare-`<small>` UA-default type size — Round D's D-TRUE-4 was never fixed and the same class measurably ships in three more producers (palette 11.67px, updates/info footers 10.83px, autocomplete descriptions 10px). Four one-line `font-size: var(--pi-text-2xs)` rules close it; the leading-literal ramp decision (E-2) is the only other open item, carried unchanged since Round B. If the owner counts carried-but-unfixed items as inside the bar, this is a green delivery with two documented one-liners pending; if not, the loop continues on E-1 alone.

Probe side effects (disclosed): 3 new empty sessions created in the pi-web workspace (New-session centering runs at 393/768/1280); in the test-workspace session "Slow Lighthouse Keeper Story": one "reply with exactly: ok" prompt (agent replied) and one "queued divider probe message" steer (queued, then answered by the agent). The live 'pi web' coordination session was never opened or written to. The pending extension-updates / AskUser dialogs in 'hu' were left untouched.

Screenshots: /tmp/rounde-shots/ (press-nav-project, press-nav-session, press-sheet-project/workspace/machine, press-goals-refresh, press-drawer-toggle, press-palette-close-phone, phone-queued-msg, phone-fold-check, phone-drawer-open-goals, newsession-393/768/1280, desktop-tasks-open, phone-tasks-open, desk-settings-rounde, desk-palette-rounde).
Scripts: /tmp/rounde-*.js, sweeps in /tmp/rounde-sweep*.json (node, cwd = repo root, playwright from repo node_modules).
