# ROUND TWO — Lane B: Pickers, dialogs and sheets (post-scale-work re-audit)

Scope walked: ModelPicker, CommandPicker (incl. thinking picker, which renders through CommandPicker via `state.thinkingDialog`), QuickSwitcher + qs-row-menu, SettingsDialog, SettingsPanelFrame + all settings panels, SettingsAppearancePanel, SessionRenameDialog, SessionCleanupDialog, AskUserCard, ExtensionDialogCard, add-project dialog (`pi-web-plugins/workspaces/browser/ProjectDialog.ts`). Contrast figures computed from the shipped palette in `src/client/index.html` (dark is the shipped default; no light palette ships in core).

Known-open items excluded: modal layer inversion, "current value" prose in pickers, drawer tab min-height 22px.

---

## F1 — AskUserCard's touch floor is width-scoped; the card sitting next to it in the same transcript says the policy is pointer-scoped
- src/client/src/components/AskUserCard.ts:663 (44px floor lives inside `@container (max-width: 580px)`); :615-622 (button base, `padding: 7px 10px`, `font: inherit` → ~36px); :559 (`.option` floor is unconditional 44px); grep for `pointer: coarse` in AskUserCard.ts returns **zero rules**
- src/client/src/components/ExtensionDialogCard.ts:531-535 — comment: *"the floor is pointer-scoped by policy, not width-scoped, so it lives outside the container query"* + `@media (pointer: coarse) { .primary-action, .secondary-action, .option-button { min-height: var(--pi-control-height-touch, 44px); } }`
- surface: every ask-user prompt and extension dialog in the transcript
- finding: two sibling cards in the same transcript slot implement the same touch-floor policy two different ways. ExtensionDialogCard was migrated to pointer-scoped floors with an explicit policy comment; AskUserCard still gates its footer buttons behind container width. AskUserCard is also internally inconsistent: its `.option` rows get 44px unconditionally (line 559, desktop included) while its primary/secondary buttons get 44px only under 580px container width.
- minimal failure scenario: iPad in landscape (transcript container > 580px, coarse pointer). An ask-user card's "Submit answer" / "Next question" buttons render ~36px tall; scroll to an extension dialog on the same screen and its "Allow once" button renders 44px. On desktop the same AskUserCard ships 44px option rows next to 36px action buttons in one card — the file's own comment at lines 555-558 ("a thumb drifting a few pixels on a 36px row … reported as Custom answers appearing from option taps") describes the bug that made 44px necessary, yet the same file exempts its own footer from it on wide coarse pointers.
- confidence: high

## F2 — Add-project dialog: primary button filled from a *border* token fails WCAG AA, and is the only green primary in the app
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:372 — `.primary { border-color: var(--pi-success-border); background: var(--pi-success-border); color: var(--pi-bg); }`
- src/client/index.html:131 (`--pi-success-border: #238636`), :115 (`--pi-bg: #0d1117`)
- contrast computed: **#238636 fill × #0d1117 label = 4.09:1** — AA normal text needs 4.5:1; the button label is UA/inherit-sized (no `font` declaration in the `button` rule at :369, no weight bump), so no large-text exemption. Even swapping to `--pi-text` (#e6edf3) does not clear 4.5.
- every other dialog's primary is accent-filled: SessionRenameDialog.ts:38, AskUserCard.ts:627, ExtensionDialogCard.ts:478 (`background: var(--pi-accent); color: var(--pi-bg)` = 7.49:1, passes)
- surface: add-project dialog footer
- finding: `--pi-success-border` is a hairline/border token being used as a control fill; it was never calibrated to carry a label. The fill choice also breaks the cross-dialog identity: "the primary action" is blue everywhere except here.
- minimal failure scenario: on a dimmed laptop screen in the default dark theme, the "Add project" label in dark-on-muted-green at 13-14px regular sits below the legibility floor at a glance, while the "Save" button they pressed one dialog earlier is clearly legible.
- confidence: high (ratio arithmetic is exact; severity assumes the shipped dark palette, which is the only core palette)

## F3 — SessionCleanupDialog is the one dialog in the fleet with zero `pointer: coarse` rules: every control lands under the 44px floor it meets everywhere else
- src/client/src/components/SessionCleanupDialog.ts — `grep -c "pointer: coarse"` = **0** (ModelPicker :289, CommandPicker :120, QuickSwitcher :485, SessionRenameDialog :41, SettingsDialog :778, ProjectDialog :351 all have coarse blocks)
- :240 footer buttons `padding: 7px 9px; font: inherit` → ~36px on touch (Cancel/Preview/Run cleanup, template :50-52)
- :231 `.selection-controls button { padding: 5px 7px; font-size: 12px; }` → ~29px — a second, smaller button tier **in the same dialog as the 36px footer row** (peer actions: "Select all" vs "Run cleanup")
- :221 `input[type="checkbox"] { width: 16px; height: 16px; }` → per-project selection checkboxes stay 16px on touch, while ProjectDialog.ts:352 and SettingsAppearancePanel.ts:124 raise their coarse checkboxes to 24px
- :244 close button is a 36px box with a 24px glyph, never raised to 44px on coarse
- surface: session cleanup dialog
- finding: two failures in one surface — (a) sibling-height inequality inside the dialog: ~36px footer tier vs ~29px selection tier vs 16px checkbox tier for three adjacent action types; (b) the entire dialog escapes the coarse-pointer floor the whole rest of the dialog fleet implements. `controlHeightScale.test.ts` cannot see it: the sizes come from padding arithmetic, not literals in the 28-44px range.
- minimal failure scenario: on a phone, open Settings → session cleanup: "Select all" is a ~29px chip while "Run cleanup" next to it is ~36px and each row's checkbox is a 16px target — three heights for four consecutive taps, next to a Rename dialog whose identical buttons are all 44px.
- confidence: high

## F4 — qs-row-menu is positioned `absolute` inside a doubly-clipped scroller, while the house pattern for row menus is `position: fixed`
- src/client/src/components/QuickSwitcher.ts:475 — `.row-menu { position: absolute; top: calc(100% - 4px); right: 0; z-index: 3; … }` (menu is ~4 rows: 4×36px + gaps + padding ≈ 160px desktop, ~200px with the coarse 44px floor at :487)
- containing blocks: `.row` (relative, :412) inside `.body { overflow: auto }` (QuickSwitcher.ts:405) inside `section[role="dialog"] { … overflow: hidden }` (ModalSurface.ts:174) — two clip levels the menu cannot escape
- house convention: src/client/src/components/shared.ts:429 — `.action-menu-panel { position: fixed; z-index: var(--pi-layer-popover); }` — every other list-row menu in the app is pinned to the viewport precisely so a scroller can not clip it
- surface: quick-switcher row menu (⋮ on a session tile)
- finding: the menu always opens downward with no flip logic and no fixed positioning; on the bottom half of the session list its lower items land under the sheet's fold, inside a scrollable region the user does not read as "the thing containing the menu".
- minimal failure scenario: several sessions open; invoke ⋮ on the last fully visible tile. Rename/Archive/Delete slide below the fold of `.body` (partially or entirely), with empty backdrop space above the tile, while the sheet itself cannot scroll because its content fits — Delete is unreachable without discovering that the list scrolls.
- confidence: high on the geometry (fixed clip chain); the exact amount hidden depends on list length.

## F5 — The close "×" is a different control in every dialog: three glyph sizes, four hit-box sizes, two of them off the type scale, and the picker pair never leaves 20×24 even on touch
- glyph sizes: 20px — ModelPicker.ts:280, CommandPicker.ts:106, QuickSwitcher.ts:401 (`var(--pi-text-xl)` = 20, on scale); 22px — SessionRenameDialog.ts:37, ProjectDialog.ts:370; 24px — SettingsDialog.ts:766, SessionCleanupDialog.ts:244. The published type scale tops out at `--pi-text-xl: 20px` (index.html:45) — 22px and 24px are scale escapes used only for this one glyph.
- hit boxes: SettingsDialog 44×44 (:766); SessionCleanupDialog 36×36 (:244); Rename/Project/QuickSwitcher auto → 44×44 only under `pointer: coarse` (SessionRenameDialog.ts:41, ProjectDialog.ts:371, QuickSwitcher.ts:484); ModelPicker.ts:280 / CommandPicker.ts:106 declare only `font-size: 20px` — no width/height/padding in base or in their coarse blocks (:289-290, :120-121) → ~20×26 target on desktop **and** on phones.
- surface: every dialog/picker header (model picker, thinking picker, quick switcher, rename, cleanup, settings, add-project)
- finding: one action, seven surfaces, zero agreement. The strongest geometric statement: on a phone, closing the model picker means hitting a ~20px target, while closing the rename dialog means a 44px target — same glyph role, same app, adjacent taps.
- minimal failure scenario: thumb lands 15px off-center on the model-picker × → no hit (20×26 box, 8px dead-zone beside it); the same user in the next dialog taps a 44px × and the inconsistency is directly felt.
- confidence: high

## F6 — Settings panels ship two heading systems, and the frame's always-rendered empty header injects a 14px ghost strip above two of them
- src/client/src/components/settings/SettingsPanelFrame.ts:48 — `<header class="section-heading">` renders unconditionally; when no `heading` property is passed it emits an empty `<h2>` slot, an empty description div and an empty actions slot, but keeps :97 `margin-bottom: 14px` → 14px of invisible space at the top of the panel.
- panels passing `heading`: GeneralPanel, PackagesPanel, PluginsPanel, SessiondPanel, ShortcutsPanel. Panels slotting their own heading: **SettingsAppearancePanel.ts:32, SettingsMachinesPanel.ts:36** — both get the ghost 14px.
- heading type then disagrees: frame h2 is `font-size: 17px`, default face, no tracking (SettingsPanelFrame.ts:100); the slotted h2s are `font-family: var(--pi-font-display); font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); letter-spacing: -0.01em` (SettingsAppearancePanel.ts:121, SettingsMachinesPanel.ts:106). Heading→content rhythm also differs: 14px (frame :97) vs 12px (`.heading`/`.machines-heading` margin-bottom `var(--pi-space-6)`, AppearancePanel:120, MachinesPanel:105).
- 14px itself is off the spacing scale (no `--pi-space-*` stop at 14; index.html scale is 2/4/6/8/10/12/16/20/24) and the frame repeats it three times (:97, :106 `.notice-stack` margin-bottom, :115 `.content` gap) inside one shared component.
- surface: Settings dialog — switching entries in the same nav
- finding: the section title of the Settings dialog renders in two typefaces with two tracking values and two heading-to-body gaps depending on which nav row you clicked, and two panels start 14px lower than the rest. This is the settings *sheet* — one surface, six identical-looking panels that are not laid out the same.
- minimal failure scenario: open Settings → General (heading flush to content edge, plain-face 17px) → click Appearance (14px dead band, then a display-face tracked heading 12px above its cards). The nav chrome is identical; the content geometry visibly jumps.
- confidence: high (all rules verified in-file; ghost-header behavior follows directly from the template at :48-53 and CSS at :97)

## F7 — The state-dot scale has a sixth size: 10px, invisible to dotScale.test.ts because the test regex matches a single digit
- src/client/src/components/settings/SettingsAppearancePanel.ts:144 — `.preview-dot { width: 10px; height: 10px; border-radius: 50%; }`
- src/client/src/components/dotScale.test.ts:35 — `/(?:width|height):\s*(\d)px/gu` — one digit only; 10px and larger never match, and `.preview-dot` is not in the `named` selector list (:33), so the line is only round-detected via `border-radius: 50%`… whose size capture finds no 1-digit match. Test passes.
- published scale: `--pi-dot-xs: 4px / --pi-dot-sm: 6px / --pi-dot-md: 8px` (index.html:85-87) — the same panel uses `--pi-dot-sm` for its active-theme dot (:136) and `--pi-dot-xs` for `.preview-line` heights (:141) **two lines away from the 10px literal**.
- surface: Settings → Appearance theme preview
- finding: inside one 4-line block, dot geometry is token, literal, token. Any future pass that retunes the dot scale (or a high-contrast theme) moves the 4/6/8px marks and silently leaves the 10px swatches behind — the exact failure mode dotScale.test.ts exists to prevent, with a hole the width of the enforcement regex itself.
- minimal failure scenario: the dot scale is bumped for a vision-impaired theme; theme cards' accent/success/warning/danger swatches keep their old 10px size, now larger than every state dot in the app.
- confidence: high (regex behavior verified against the test source)

## F8 — Three picker search fields, three different heights — no control-height token in any of the three recipes
- QuickSwitcher.ts:401 — `input { height: var(--pi-control-height-comfort); }` → 36px (only one that names the scale)
- src/client/src/components/CommandPicker.ts:107 and ModelPicker.ts:281 — `padding: 8px 10px` + 16px font, no `min-height` on fine pointers → ~40px (the coarse block at CommandPicker :120-121 / ModelPicker :289-290 only adds a 44px floor; fine-pointer height stays padding-arithmetic)
- pi-web-plugins/workspaces/browser/ProjectDialog.ts:336 (`padding: 9px`, 16px font, no height) → ~42px
- surface: model picker / thinking picker header, quick switcher header, add-project body
- finding: `--pi-control-height-comfort: 36px` (index.html:78) exists exactly to name this control; two of three pickers size the same field by padding arithmetic instead, 4px apart from each other. The inequality is visible when the same user opens the model picker (≈40px search) after the quick switcher (36px search); on touch devices the picker inputs jump 36→44→42 between surfaces.
- minimal failure scenario: quick switcher (36px field) → model picker (40px field) → add project (42px field) in one session: the focus ring the user anchors on sits at three different heights.
- confidence: medium-high (heights are padding+font arithmetic; ~1-2px rendering variance, but the three values are measurably distinct and unscaled)

## F9 — QuickSwitcher's footer CTA is a touch-sized 44px button on desktop, standing next to a 36px field and 32px chips in the same sheet
- src/client/src/components/QuickSwitcher.ts:502 — `footer button { min-height: var(--pi-control-height-touch); }` — no media query; the same file scopes every *other* 44px promotion to `@media (pointer: coarse)` (:485-490)
- sheet siblings on a mouse: search field 36 (:401), chips 32 (:446), machine tabs 36 (:436), row-menu buttons 36 (:476)
- surface: quick switcher sheet
- finding: the touch token is applied unconditionally to one control, in direct contradiction of the file's own comment at :481-484 ("Coarse pointers get the comfort floor: every target the quick switcher ships measures 44px on touch") — on a desktop it is *not* coarse, yet the "New session" row is 44px while everything it sits beside is 32-36px. controlHeightScale.test.ts misses it (the height comes from `var()`, not a literal).
- minimal failure scenario: desktop user: the primary CTA in the sheet is a visibly chunkier box than its own search field 40px above it — one control on the screen is "finger-sized" for a mouse user.
- confidence: high on geometry; medium on intent (a deliberate emphasis reading exists, but then the scale is being used as emphasis, which is what the scale was named to stop)

## F10 — `font-weight: 650` is a de facto fourth weight step, used 8 times across 6 components while the published weight scale stops at 600
- occurrences (non-test): AskUserCard.ts:534, :627; ExtensionDialogCard.ts:371, :478; QuickSwitcher.ts:421, :423; appShell/AppContextBar.ts:76; SessionList.ts:705
- published tokens: `--pi-weight-regular: 400; --pi-weight-medium: 500; --pi-weight-semibold: 600` (index.html:48-50) — and the same components switch to 600 nearby (QuickSwitcher.ts:406 h3 `font-weight: 600`; AskUserCard/ExtensionDialogCard legends 600)
- surface: unread-state titles and dialog primary buttons across both pickers and both transcript dialogs
- finding: 650 is used consistently *by instinct* — unread session titles in QuickSwitcher and SessionList match, primary actions in both cards match — i.e. it has become a scale step (an "emphasised label" tier) with no token behind it. Non-variable system font stacks quantize 650 to different faces per OS (Semibold 600 vs Bold 700), so the same unread-session label renders two weights across platforms, while an adjacent 600 label in the same sheet does not drift. The designTokens.test.ts "single-component judgment" allowance covers a one-off; eight coordinated uses across six components is a named step that never got named.
- minimal failure scenario: on a Windows machine (Segoe UI variable ranges snap differently than SF), QuickSwitcher's unread titles render Bold while the same titles in SessionList's panel render Semibold — the two unread markers in the product stop matching each other.
- confidence: medium (the drift depends on installed face ranges; the scale-escape itself is exact)

---

### Checked and deliberately NOT reported
- `CommandPicker.ts:104` `outline: 2px` literal — equals `var(--pi-focus-ring-width)`; single-component judgment call.
- `outline-offset: 1px` on picker inputs — used consistently in ~10 places across the app; consistent even though `--pi-focus-ring-offset` is 2px.
- QuickSwitcher footer `max(10px, env(safe-area-inset-bottom))` — 10px is on the spacing scale.
- Selection fills (`--pi-selection-bg` #0d2847 with `--pi-text`/`--pi-text-bright`) — 9:1+; accent-filled primaries (`#58a6ff`/`#0d1117`) 7.49:1; warning/danger text states all ≥ 6.8:1. F2 is the only AA failure on a filled control found in this lane.
- `.row-flag` 8px / `.theme.active::after` 6px dots — on the dot scale.

DONE
