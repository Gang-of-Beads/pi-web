# Round 8 - Lane B: pickers, dialogs, sheets after the scale work

Scope walked (static read + cascade/box arithmetic, all file:line verified against HEAD cf5f0ce1):
`ModelPicker.ts`, `CommandPicker.ts`, `QuickSwitcher.ts` (incl. qs-row-menu), `SettingsDialog.ts`,
`SettingsPanelFrame.ts`, `settingsControlStyles.ts`, all settings panels (Appearance, General,
Shortcuts, Machines, Plugins, Packages, Sessiond, FleetSection), `SessionRenameDialog.ts`,
`SessionCleanupDialog.ts`, `AskUserCard.ts`, `ExtensionDialogCard.ts`, `ModalSurface.ts`, `shared.ts`,
`ProjectDialog.ts`/`addProjectDialog.ts`, `MachineDialog.ts`, `MachineSwitcher.ts`.
Baseline respected: r1-r7 fixes and explicitly-open items (modal layer inversion, "current value"
prose, drawer tab 22px, r1 F18 prose mark) are not re-counted.

## F1 (medium) - The 24px-checkbox vertical-centering law (r5 F6) was migrated everywhere except two producers; both sit in this lane and both are now the last of their kind

The law was established by measurement in round 5 (r5-lane-c F6): a `--pi-checkbox-size` (24px) box in a
row with 14px text cannot share the first-line midline via `align-items: start` plus a small positive
top margin; the sibling surfaces were converted to `align-items: center` with `margin: 0`. Verified fixed
state of the migrated surfaces:
- `src/client/src/components/settings/SettingsAppearancePanel.ts:124-126` - `.follow { align-items: center }`, `.follow input { margin: 0 }`
- `src/client/src/components/SessionCleanupDialog.ts:220-221` - `.toggle-row { align-items: center }`, checkbox has no margin
- `src/client/src/components/ModelPicker.ts:302,305` - `.catalog-row { align-items: center }`, checkbox margin is horizontal only
- `pi-web-plugins/workspaces/browser/ProjectDialog.ts:336,338` - `.check { align-items: center }`, `.check input { margin: 0 }`

Two producers were missed, and a grep across all non-test sources shows they are the only remaining
checkbox/radio rows whose 24px box carries a positive top margin:

1. `src/client/src/components/AskUserCard.ts:549` + `:567`
   - `.option { align-items: start; min-height: var(--pi-control-height-touch) }` (:546-559, border-box, padding 8)
   - `input { width/height: var(--pi-checkbox-size); margin: var(--pi-space-1) 0 0 }` (:567)
   - `.option-label { line-height: 1.35 }` (:570) -> first-line box 14 x 1.35 = 18.9px
   - Arithmetic, one-line option (the common case): the grid row is stretched to 44 - 16 padding - 2 border = 26px
     and items sit at its top. Text ink center: 8 (padding) + 18.9/2 = 17.45px from the row edge. Checkbox center:
     8 + 2 (margin) + 12 = 22px. The box hangs **4.5px below the label it belongs to**. Two-line copy
     (label + `.option-detail`, 12 x 1.35 = 16.2px, gap 4): the copy block spans 8..47.6, its center is 27.8;
     the box at 22 now reads **5.8px above** the block. The checkbox is aligned to neither line, at either copy length.
2. `src/client/src/components/settings/SettingsShortcutsPanel.ts:364-365`
   - `.prompt-enter-option { align-items: start }` (:364), radio `.prompt-enter-option input { margin: var(--pi-space-2) 0 0 }` = **4px** (:365)
   - First line is `strong` at 14px, line box ~16.8px -> text center 8.4 from the grid top; radio center is
     4 + 12 = 16 -> **7.6px below the option label**. This is r5-lane-c F6 with a larger offset (that one measured 5.5px),
     living on the settings surface where the law was invented. The 4px margin predates the box: at the time of
     r5-lane-b:83 this input was 14px (14 + 2 x 4 = centered-against-22), the `c7fa10da` growth to 24px turned a
     working offset into a visible one - the same stale-compensation mechanism r5 named.

Minimal failure scenario: open any ask-user card and look at the option list - every tick box sits visibly
low against its label; open Settings > Shortcuts > the Enter/Shift-Enter radiogroup - the radio hangs between
the option title and its description, touching neither.

Minimal fix: the migrated pattern, both places: drop the top margin (`margin: 0`) and center the row
(`align-items: center`), matching `SettingsAppearancePanel.ts:124-126`. (For deliberately multi-line copy
the first-line-midline idiom would instead need `margin-top: calc((1.35em - var(--pi-checkbox-size)) / 2)`;
every migrated sibling chose plain centering, so centering is the house answer.)

## F2 (low) - ModelPicker: the coarse-pointer checkbox rule is shadowed by its own base rule, and the comment claims it raised the target

- `src/client/src/components/ModelPicker.ts:290-292` - comment: "Coarse pointers get the comfort floor across
  the popover chrome: the close button, scope chips, search field, and **catalog checkboxes are all touch
  targets** on a phone."
- `:293-298` coarse block raises close (:294), scope chips (:295) and search (:296) to `--pi-control-height-touch` (44px);
  the fourth promise, `:297` `input[type=“checkbox”] { width/height: var(--pi-checkbox-size) ... }`, sets **24px** -
  the exact value the base rule `:305` `.catalog-row input[type=“checkbox”] { ... }` already applies.
- Cascade fact: the only checkboxes in the component are inside `.catalog-row` (template `:156-168`, `renderCatalogRow`;
  no other `type=“checkbox”` producer). `.catalog-row input[type=“checkbox”]` (specificity 0-2-1, source :305)
  outranks `input[type=“checkbox”]` (0-1-1, :297) on every overlapping declaration (box-sizing, width, height,
  accent-color) **and is declared later in source**. Rule :297 therefore has **zero effect in both pointer modes** -
  and note the third line of the comment at :292 asserts the exact invariant that :305 breaks: "Declared after every
  base rule it raises." The catalog rule was appended after the media block, so both the specificity and the ordering
  promise are false for the one control the comment names.
- Consequence: on a phone the per-model enable/disable checkbox - the state-changing control of the row, standalone
  (not a label wrap; the adjacent `.pick` button is the separate 52px target, template :162-168) - stays a 24x24
  target while all the rest of the popover chrome got 44px two lines above. r7-lane-b:167 recorded the pair as
  "“:304 base, :297 coarse - both take --pi-checkbox-size”", i.e. read as a compliant coarse bump; nobody has yet
  recorded that the bump never fires and the comment promises more than the code does.
- Guard note: this is invisible to every existing guard - `controlHeightScale.test.ts` windows 28-44px (24 is below),
  and no guard checks coarse-rule effectivity.

Minimal fix (owner call, one of): raise the coarse rule to a real floor
(`.catalog-row input[type=“checkbox”] { width: var(--pi-control-height-touch); height: ... }`), or delete :297 and
amend the comment at :291 to state that checkboxes deliberately stay at `--pi-checkbox-size` on both pointers.

## F3 (low, re-verified residual of a fix that landed elsewhere) - SessionCleanupDialog selection buttons are still the byte-identical pre-fix form of what round 7 fixed in SessionList

- `src/client/src/components/SessionCleanupDialog.ts:231` - `.selection-controls button { padding: var(--pi-space-3) var(--pi-space-4); font-size: var(--pi-text-xs) }`,
  no `min-height` on fine pointers; the file’s own coarse block (:249-252) raises them, desktop does not:
  ~14 + 12 + 2 = **~28px**, against `button { padding: var(--pi-space-4) var(--pi-space-5); font: inherit }` footer
  actions at ~39px (:240) and a 36px close (:244) in the same panel. This is r3-lane-b B8 verbatim - still open.
- What makes it reportable now: round 7 landed the exact fix for the identical pattern one surface away -
  `src/client/src/components/SessionList.ts:704` now reads `.bulk-row button { min-height: var(--pi-control-height); padding: var(--pi-space-3) var(--pi-space-4); font-size: var(--pi-text-xs) }`
  (same padding pair, same font-size token, plus the floor). The convention exists; one producer was missed.
  28px also escapes the control-height guard because the value is derived, not a literal.
- Minimal fix: add `min-height: var(--pi-control-height)` at :231, mirroring `SessionList.ts:704`.

## Known-and-open (verified unchanged, one line each - do not count)

- Close-control family split 32/36: 32 = ModelPicker.ts:286, CommandPicker.ts:107, QuickSwitcher.ts:403,
  SessionRenameDialog.ts:37, ProjectDialog, MachineDialog.ts:146; 36 = SettingsDialog.ts:766, SessionCleanupDialog.ts:244,
  ContextSwitcherSheet. Tracked since r3 B1 / r6 watchlist ("risky, two commits certify opposite halves").
- `ExtensionDialogCard.ts:424` `.dialog-input { width: calc(100% - 32px) }` hardcodes 2x `--pi-space-7` (r3 B10, watchlisted r6).
- `SessionRenameDialog.ts:33` input still `font: inherit` -> 14px where the control family publishes 16px (r3 B9, r4 C4).
- `ModelPicker.ts:306` `.pick` type spec disagrees with `.options > button` (r5-lane-c F2, open, lane C owned).
- `QuickSwitcher.ts:467` dead `font: var(--pi-text-xs)` immediately overridden by `font-size: var(--pi-text-lg)` on the
  same declaration; the :488-491 coarse block is a verbatim no-op (r5-lane-c:182). Cosmetic.
- Dead duplicate `padding: 0` under `header button` rules: SessionRenameDialog.ts:37, MachineDialog.ts:146, ProjectDialog (~:376) - r7 F1 residue.
- `ModelPicker.ts:175` literal " current" prose - triage "still open" owner item (r1 F18).
- Non-control explicit sizes judged policy-exempt and unchanged: `.preview 74/64` (Appearance :154/:162-ish),
  textarea `94px` (GeneralPanel), `.row 52px` / `.row-menu 160px` (QuickSwitcher), table `620px` / `88px days input` (Cleanup),
  `.suggestions 90/320` (ProjectDialog).

## TOTAL: 2 new findings (3 rule instances counted as one) + 1 re-verified residual

Priority for the fixer: F1 is visible at arm’s length on two shipped surfaces and has a proven one-line fix
pattern already applied to four siblings; F2 is honesty-of-code (dead rule + comment that overstates it);
F3 is one token away from the round-7 pattern.
