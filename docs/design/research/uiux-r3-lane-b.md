# ROUND 3 CONVERGENCE AUDIT — LANE B: pickers, dialogs, sheets

Scope audited: ModelPicker, CommandPicker, QuickSwitcher (+ qs-row-menu), SettingsDialog,
settings/SettingsAppearancePanel, SessionRenameDialog, SessionCleanupDialog, AskUserCard,
ExtensionDialogCard, AuthDialog (focus rules only), ModalSurface, shared.ts surfaces,
pi-web-plugins workspaces ProjectDialog/addProjectDialog, machines MachineDialog/addMachineDialog.
All round-1/round-2 fix lists and deliberately-open items were excluded.
Every finding below was checked against the guard tests to confirm it is *unguarded*,
so each one can drift again after it is fixed.

## B1. Sibling dialogs' close buttons disagree on height at the same pointer type (medium)
- `SettingsDialog.ts:766` — `.close-button { width/height: var(--pi-control-height-touch) }` → **44×44 unconditionally**, desktop included.
- `SessionCleanupDialog.ts` (`.close-button` rule) — `var(--pi-control-height-comfort)` → **36×36 on desktop**, 44 only under `pointer: coarse`.
Both dialogs are the same family (header/title/close, modal-surface, identical header layout), rendered from the same settings area; the same action is 44px in one dialog and 36px in the next, and each file states the opposite policy for fine pointers. (SessionRenameDialog, ModelPicker, CommandPicker, ProjectDialog, MachineDialog header closes are content-sized ~24px on fine — a third policy — but those were round-2 territory; the Settings-vs-Cleanup pair is the concrete, unfixed disagreement.)
Fix: one shared `.dialog-close` rule (or interactiveSurfaceStyles entry) sized from the control-height tokens with the coarse bump; both dialogs adopt it.

## B2. SettingsDialog mobile chrome is a cluster of spacing-scale escapes (medium)
`SettingsDialog.ts` inside `@media (pointer: coarse), (max-width: 760px)`:
- L780 `.settings-header { padding: max(12px, env(…)) 12px 12px; }` — three bare `12px` (= `--pi-space-6`).
- L782 `.settings-list { padding: 6px 0 calc(14px + env(…)); }` — bare `6px` (`--pi-space-3`) and `14px`, and **14px is on no spacing step** (scale: 2/4/6/8/10/12/16/20/24).
- L790 `.settings-content { padding: 14px 12px calc(18px + env(…)); }` — off-scale `14px` and `18px` again; rhythm is header 12 vs list 14 vs content 14/18/12 with no scale relation.
- L789 `.settings-back { margin-left: -8px; }` — bare negative `8px` (`--pi-space-4`).
Why guards miss it: `spacingScale.test.ts` exempts any value containing `max(`/`calc(` (the whole declaration is skipped), and its literal regex can't match a negative value (`-8px`). So every one of these can silently regress. Fix: `var(--pi-space-6)`/`var(--pi-space-3)` inside the `max()`/`calc()`, pick 12 or 16 for the 14/18 slots, `calc(var(--pi-space-4) * -1)` for the back button.

## B3. Literal `outline: 2px` focus rings inside picker/dialog surfaces while siblings tokenize (medium, drift risk)
`--pi-focus-ring-width: 2px` exists and is used by ModelPicker (`:278,:282`), QuickSwitcher (`:403,:449`), CommandPicker's own search input (`:108`), SessionRenameDialog, SettingsAppearancePanel, shared.ts — but these in-scope rules still hardcode it:
- `CommandPicker.ts:104` `.options:focus-visible { outline: 2px solid … }` (the file tokenizes the *next* line — internal inconsistency)
- `AskUserCard.ts:524` `fieldset.question:focus-visible`, `:566` `input/textarea/button:focus-visible`
- `ExtensionDialogCard.ts:404` `.dialog-detail:focus-visible`, `:477` `button/.dialog-input:focus-visible`
- `AuthDialog.ts:270,271` `.options`/`input:focus-visible`
- `pi-web-plugins/machines/browser/MachineDialog.ts:139` `input:focus-visible`
Guard gap: `designTokens.test.ts:69-71` only scans `listStyles`; component-level `outline:` shorthands are unguarded. Pixels match today, so this is a one-token-change-away inconsistency, which is exactly what the token exists to prevent.

## B4. `font: 14px system-ui, sans-serif` on :host bypasses both the type and the font-family scale (medium)
In-lane offenders: `ModelPicker.ts:271`, `CommandPicker.ts:98`, `SettingsDialog.ts:760`, `SessionCleanupDialog.ts` (:host), `AskUserCard.ts` (:host), `ExtensionDialogCard.ts` (:host), `pi-web-plugins/machines/browser/MachineDialog.ts:130`.
Correct pattern already in the same family: `QuickSwitcher.ts:392` and `SessionRenameDialog.ts:26` use `font: var(--pi-text-base) var(--pi-font-ui)`.
`14px` is `--pi-text-base` written as a literal, and bare `system-ui` skips the published `--pi-font-ui` stack (`ui-sans-serif, system-ui, …`, index.html:109), so a theme that redefines the UI face silently doesn't reach these seven surfaces. Invisible to `typeScale.test.ts` because the guard regexes key on `font-size:` and the shorthand hides the size.

## B5. AskUserCard header does not share the card's left edge (medium, alignment + sibling disagreement)
- `AskUserCard.ts` `.card-header { padding: var(--pi-space-4) var(--pi-space-5) var(--pi-space-3) }` → header text inset **10px**, while every body block in the same card (`fieldset.question`, `.record-question`, `.form-footer`, `.record-summary`) is inset `var(--pi-space-7)` = **16px**. The "Questions" heading hangs 6px left of its own card's content column.
- The twin card in the same waiting slot, `ExtensionDialogCard.ts` `.card-header`, uses `var(--pi-space-7)` horizontally and aligns — two cards with identical header contracts (same min-height, border, shadow) disagree with each other and one disagrees with itself.

## B6. SettingsAppearancePanel status dots are 10px — a sixth dot size off the published dot scale (low-medium, scale escape)
`SettingsAppearancePanel.ts`: `.preview-dot { width: 10px; height: 10px; border-radius: 50% }`. The dot scale is `--pi-dot-xs: 4 / --pi-dot-sm: 6 / --pi-dot-md: 8` (index.html:89-91), and this panel is the surface that *showcases the dot vocabulary* (accent/success/warning/danger state dots). Guard gap: `dotScale.test.ts` regex is `(\d)px` — single digit only, so 10px slips through. Appearance is also the lane where a new dot size gets copied into future theme cards.

## B7. SessionCleanupDialog checkboxes stay 16px on touch while every sibling dialog raises them to 24px (medium, sibling control mismatch)
- `SessionCleanupDialog.ts:221` `input[type="checkbox"] { width: 16px; height: 16px }`; its `pointer: coarse` block only raises `button` and `.close-button`, not the three checkboxes (2 threshold toggles + the per-row "Clean up" selection checkbox, which is the primary touch action of the table).
- Siblings: `ModelPicker.ts:291` (coarse → 24×24), `ProjectDialog.ts` (coarse `.check input` 24×24), `SettingsAppearancePanel.ts` `.follow input` 24×24.
The file's own comment says "this one shipped ~36px footer actions" and fixed the buttons but left the actual per-project decision control at 16px on a phone.

## B8. SessionCleanupDialog: same-role text buttons at three heights on desktop (low-medium, sibling height mismatch)
Footer actions (`Preview`, `Run cleanup`) compute ≈38px (padding `space-4`+`space-5`, 14px text); `.selection-controls button { padding: var(--pi-space-3) var(--pi-space-4); font-size: var(--pi-text-xs) }` computes ≈28px — under even the `--pi-control-height: 32px` desktop standard — while sitting ~30px above/below the 38px footer pair and 36px close button inside the same panel. Coarse is handled (44px floor); fine-pointer heights inside one dialog disagree.

## B9. SessionRenameDialog text input drops the control-font convention → 14px field where every sibling input is 16px (medium)
`SessionRenameDialog.ts`: `input { font: inherit; … }` → 14px. Every sibling text field in this lane uses the published control size: `ModelPicker.ts:281`, `CommandPicker.ts:107`, `SessionCleanupDialog.ts` (`input.days`), `ProjectDialog.ts`, `MachineDialog.ts` — all `var(--pi-control-font-size, 16px)` (index.html:112). Consequences are geometric and behavioral: the input's content box sits a step smaller than sibling fields, and iOS Safari auto-zooms the viewport on focus for sub-16px inputs — precisely the phone flow (rename a session) this dialog exists for.

## B10. ExtensionDialogCard: `.dialog-input { width: calc(100% - 32px) }` hardcodes 2×`--pi-space-7` (low, scale escape by coupling)
`ExtensionDialogCard.ts` — the input's inline margins are `var(--pi-space-7)` (16px) each, and the width literal `32px` must equal 2× that token or the row miscenters/overflows. One of the two values must move with the token; today neither does. (`box-sizing: border-box` is set, so `width: 100%` inside a padded container, or `margin-inline: var(--pi-space-7)` + `width: calc(100% - 2 * var(--pi-space-7))`, removes the hidden coupling.)

## B11. QuickSwitcher state-flag slot: raw offset and an off-scale second diameter (low)
- `QuickSwitcher.ts:428` `.row-flag, .row-state { bottom: var(--pi-space-4); right: 12px; }` — the vertical offset reads the spacing token, the horizontal one is a bare `12px` (`--pi-space-6`). `spacingScale.test.ts` only guards `padding|margin|gap`, so positioning offsets are an unguarded class; this is the only such literal in the file.
- Same rule: `.row-flag.interrupted` adds `border: 2px solid …` without `box-sizing: border-box`, so the hollow variant renders a **12px outer circle where the filled `.unread` renders 8px** (`--pi-dot-md`) — two states of one slot disagreeing on diameter, and 12px is off the dot scale (and invisible to `dotScale.test.ts`, which only reads width/height).

## Checked, deliberately not reported (to bound round-3 re-runs)
- `.row { min-height: 52px }`, `.suggestions { min-height: 90px }`, textarea `min-height: 68px`, `.preview { height: 74px }` etc. — explicit sizes, excluded from the scale guards by documented policy.
- `.settings-back { margin-left: -8px }` is listed under B2 as a token-read issue, not as an optical-alignment debate (the negative is deliberate flush alignment).
- `AskUserCard .other-answer { padding-left: 32px }` — hand-tuned indent approximating input-width + gap; it's a magic number (~3px off the real option column, UA checkbox width dependent) but it's a one-off judgment inside a component, which the scale contract explicitly permits; noted here only so round 4 doesn't count it as new.
- AskUserCard radio/checkbox stay native-size on coarse — acceptable because the whole `.option` label row is the 44px hit target (unlike B7, where the checkbox is the row's only control).
- Contrast: no new confident AA failure found in-lane; the remaining muted-on-surface small text (`.row-subtitle`, `.header-status`) is the already-open deliberate item, and the danger-text-on-10%-danger-mix in SessionCleanupDialog sits above threshold in both shipped themes.
- `.row-menu { top: calc(100% - 4px) }` — 4px seam overlap, deliberate border-hiding trick, size not spacing.

## Cross-cutting root causes (worth one systemic fix each)
1. **Positioning offsets (`top/right/bottom/left`, negative margins) and `max()/calc()`-wrapped values are outside the spacing guard's grammar** — B2 and B11 are all guard-invisible. Extending `spacingScale.test.ts` to strip `env()`/`max()`/`calc()` wrappers and match `-Npx` would have caught every B2/B11 literal.
2. **The `font:` shorthand is outside the type guard's grammar** (B4 is invisible to `typeScale.test.ts`; both QuickSwitcher and SessionRenameDialog prove the tokenized shorthand is already the house style).
3. **Focus-ring tokenization is asserted only for `listStyles`** (B3) — moving that assertion to a full-component scan like `dotScale.test.ts` does would convert 6 in-lane literals into a maintained invariant.
4. **Dialog chrome (close button, input font size, checkbox coarse floor) is re-decided per dialog** (B1, B7, B9) — these three are exactly the properties `interactiveSurfaceStyles` exists to own once.
