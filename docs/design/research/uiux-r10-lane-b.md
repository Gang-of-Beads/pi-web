# Round 10 — Lane B findings (pickers, dialogs, sheets)

Scope: ModelPicker, CommandPicker, QuickSwitcher, SettingsDialog (+ all panels),
SessionRenameDialog, SessionCleanupDialog, AskUserCard, ExtensionDialogCard,
add-project dialog (ProjectDialog), add-machine dialog (MachineDialog),
MachineSwitcher, MachineList. Repo at d167533d (round-nine lane C fix).
All line numbers verified against working tree.

## F1 — The state dot and the menu glyph do not share the centre line the CSS claims (geometric centre escape)

- `src/client/src/components/QuickSwitcher.ts:426-430`
- Companion claim: `src/client/src/components/shared.ts:396-398`

`QuickSwitcher.ts:430`:

    .row-flag, .row-state { position: absolute; bottom: var(--pi-space-5);
      right: calc((var(--qs-menu-size) - var(--pi-dot-md)) / 2 + var(--pi-space-3)); }

The comment immediately above (:426-429) says the mark "sits under the corner menu
button", and `shared.ts:396` states the pairing rule explicitly: "The mark and the row
menu read as one pair: **same centre line**, as the tile variant states for itself
below." Sharing the centre line requires `right: (menu-size − dot)/2`. The extra
`+ var(--pi-space-3)` puts the dot's centre at `menu-size/2 + 6px` from the right edge,
while the `⋯` glyph centres at `menu-size/2` (`.row-menu-toggle`, QuickSwitcher.ts:467,
is exactly `--qs-menu-size` wide). The dot is 6px left of the button glyph on fine
pointers (32px: 22 vs 16) and still 6px off on touch (44px: 28 vs 22). The claim and
the arithmetic disagree; one term must go — either drop `+ var(--pi-space-3)` or drop
the "same centre line" claim. (shared.ts:398's `.action-activity { right: var(--pi-space-3) }`
puts its dot centre 10px from the row edge against a 32px/44px menu column whose glyph
centres at 16/22px — the same verb is aligned differently in the two lists that
reference each other in comments.)

## F2 — Machine "offline" is three different states in three adjacent surfaces, one of them bare text

- Trigger: `pi-web-plugins/machines/browser/MachineSwitcher.ts:84`, styles `:302-304` — `<span class="machine-status ${status}">` is a **colour-only word** (`.machine-status.online { color: var(--pi-success) }`, offline/error `var(--pi-danger)`), no mark.
- Its own menu: `MachineSwitcher.ts:111`, `:322-328` — dot + word, and offline is **grey**: `.machine-option-status.offline .dot { background: var(--pi-dim) }` (word stays muted).
- The list row: `pi-web-plugins/machines/browser/MachineList.ts:258-260` — dot + word where offline is **red**: `.machine-status.offline, .machine-status.error { color: var(--pi-danger) }` and the `::before` dot inherits `currentColor`.

Round nine ("two states, two channels") established mark+word as the house pattern for
machine state, and `MachineList.ts:256-257` even says "The same mark-plus-word **the
switcher uses**". But the switcher's own trigger (line 84) is the one instance still
welding the state to bare coloured text, and the three surfaces disagree on what
"offline" looks like: red word, grey dot, red dot+word. The trigger is the only
machine-state the user sees 100% of the time (menu closed).

## F3 — ExtensionDialogCard: the answer input is the one control in the card with no touch floor, at any pointer

- `src/client/src/components/ExtensionDialogCard.ts:424-435`
- Policy statement + floor: `:519-521` ("A control a person taps is a touch target
  wherever the card is shown"), `.primary-action, .secondary-action, .option-button { min-height: var(--pi-control-height-touch) }` — 44px on desktop *and* coarse (`:537`).

`.dialog-input` has `padding: var(--pi-space-4)` and `font: 16px/1.4`, giving ≈40px,
with no `min-height` at all. In an input dialog the Cancel/Send buttons directly below
it are 44px by the card's own explicit policy — the field the user actually taps first
is the only control that escapes the floor, on phones included. Additionally:

    width: calc(100% - 32px);   // :426

hardcodes the 2×16px its own `margin: var(--pi-space-6) var(--pi-space-7) 0` removes;
it should be `calc(100% - 2 * var(--pi-space-7))`. A token bump silently mis-fits the
field. (Nearby, the comment at :533-536 still references a "42px desktop rule" that no
longer exists — :521 already applies 44px on desktop; stale comment, same fix area.)

## F4 — `textarea { min-height: 94px }` overrides the shared control-scale derivation with a bare literal

- `src/client/src/components/settings/SettingsGeneralPanel.ts:279`
- Contract it overrides: `src/client/src/components/settings/settingsControlStyles.ts:17` — `textarea { min-height: calc(var(--pi-control-height) * 2) }` (64px)
- Duplicated literal: `src/client/src/components/SessionTreeNavigator.ts:594` (same `min-height: 94px`, no token, second copy)

SettingsGeneralPanel imports `settingsControlStyles` (SettingsGeneralPanel.ts:2, :254)
and then replaces its only derived two-row control height with 94px — a value on no
scale (control-height ×2 = 64, ×3 = 96, space-8×4 = 80/96). It survived rounds 1–9
because no guard compares a panel value against the shared derivation it overrides.
Either the contract is wrong (fix `settingsControlStyles.ts` once, both files follow)
or the contract is right (delete both 94px overrides). As written, the settings dialog
and every other settings textarea (64px) present two unrelated textareas side by side.

## F5 — List/tile row min-heights have drifted to four near-identical literals: 52 / 56 / 58 / 60

- `src/client/src/components/QuickSwitcher.ts:411` — `.row { min-height: 52px }`
- `src/client/src/components/shared.ts:318` — `.list-body.tiles .action-main { min-height: 56px }`
- `src/client/src/components/SettingsDialog.ts:784` — `.settings-list button { min-height: 56px }`
- `pi-web-plugins/machines/browser/MachineList.ts:261` — `.machine-row .action-main { min-height: 58px }`
- `pi-web-plugins/machines/browser/MachineSwitcher.ts:319` — `.machine-option-main { min-height: 60px }`

Four values 8px apart across one product are visually indistinguishable individually
but make the same "two-line tile" rhythm measure differently on every screen the
switcher touches; none is derived from a token (2×touch = 44, three text lines, or any
stated row scale — none holds). Round 9 unified the marks inside these rows; the row
boxes themselves are the remaining un-tokenised rhythm break. One `--pi-row-height`
(or reuse of a token expression) should own all five.

## F6 — The same modal chrome carries two close-button sizes: 36px and 32px

- 36×36 (`--pi-control-height-comfort`): `src/client/src/components/SettingsDialog.ts:766`, `src/client/src/components/SessionCleanupDialog.ts:244`, `src/client/src/components/QuickSwitcher.ts` (`.close`, comfort box).
- 32×32 (`--pi-control-height`): `src/client/src/components/SessionRenameDialog.ts:37`, `pi-web-plugins/machines/browser/MachineDialog.ts:146`, `pi-web-plugins/workspaces/browser/ProjectDialog.ts:377`.

Both groups render the identical header pattern — title left, transparent `×` at
`var(--pi-text-xl)` in a fixed square right — inside the same `modal-surface` frame,
and all raise to 44 on coarse pointers. On fine pointers the rename dialog's close
measurably differs from the cleanup dialog's close although the two are opened from
the same menu, and the glyph's optical centre inside 32px at 20px font sits tighter to
the frame edge than in the 36px sibling. One size token for the dialog close (comfort,
as the majority + QuickSwitcher already agree) removes the split.

## Assessed and cleared (do not re-litigate)

- `×` close glyph as text: consistent across all ten dialogs — it is the house close mark; unlike the round-9 `▸/▾` case, nothing competes with an SVG version.
- SettingsDialog phone-list `›` (`:196`): drill-in affordance, not the expand/collapse verb `disclosureIcon.ts` owns. Different verb, leave it.
- `.theme.active .theme-name::after` dot vs `themeCardLabel` " · in use" suffix — dot is the active indicator, the text distinguishes selected-but-not-active; both channels intentional.
- Plugin `.status` pills (`SettingsPluginsPanel.ts:213-217`) — pill shape carries the mark role; `.status.warning { color: var(--pi-text) }` is AA-safe (warning on warning-surface computes ≈6.9:1 so the tone colour *would* pass — the neutral text is a consistency wart, not a contrast failure).
- `.trust-hint a { min-height: 24px }` (`ProjectDialog.ts:362`) — matches the WCAG 2.5.8 24px target floor; not an escape.
- Accent fill contrast: `--pi-on-accent #0d1117` on `--pi-accent #58a6ff` ≈ 7.5:1. Fine.

## Nits (fold into any of the above touches)

1. `padding: 0` followed by `padding: 0 var(--pi-space-4)` in the same block — dead
   first declaration, copy-pasted three times: `SessionRenameDialog.ts:37`,
   `MachineDialog.ts:146`, `ProjectDialog.ts:377`.
2. `ExtensionDialogCard.ts:360` — `.card-header { min-height: 22px }` is inert
   (content + padding already ≈35px) and 22px is not on any scale; delete.
3. `MachineDialog.ts:148` — `.primary { border-color: var(--pi-accent) }` can never
   paint: the base `button` rule at `:145` sets no border while
   `SessionRenameDialog`/`ProjectDialog` siblings keep `border: 1px solid` — the fill
   matches but the primary affordance's edge differs between the two plugin dialogs.
