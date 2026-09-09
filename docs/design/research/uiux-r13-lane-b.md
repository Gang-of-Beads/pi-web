# Round 13 · Lane B — pickers, dialogs, sheets (post-scale audit)

Scope: ModelPicker, CommandPicker, QuickSwitcher, SettingsDialog + settings panels,
SessionRenameDialog, SessionCleanupDialog, AuthDialog, AskUserCard, ExtensionDialogCard,
ModalSurface, shared.ts, workspaces/ProjectDialog, machines/MachineDialog.
Only NEW findings. Excluded as known/deliberate: Modal layer inversion, picker "current value"
prose, drawer tab 22px, `--pi-muted` on page bg, typed `×`/`✓` glyphs as house pattern,
`--pi-dot-sm` 6px inline role, and every round-12 fix already applied.

Contrast and pixel figures are computed from the declarations, not eyeballed. Dark theme;
`--pi-surface-raised` resolves to rgb(55,61,67).

---

## B1 · ExtensionDialogCard: every tappable control is 16px taller than it declares — HIGH

`src/client/src/components/ExtensionDialogCard.ts:466` — the card's `button` rule sets no
`box-sizing`, and there is **no global reset anywhere**: `src/client/index.html` has zero
`box-sizing` declarations, and a document rule would not cross a shadow boundary anyway.
`min-height` therefore applies to the *content* box:

| control | declared | block padding | rendered border box |
|---|---|---|---|
| `.option-button` (:413, :526) | `min-height: var(--pi-control-height-touch)` = 44 | 8 + 8 (`--pi-space-4`) | **60px** |
| `.primary-action` / `.secondary-action` (:466, :526) | 44 | 8 + 8 | **60px** |
| `.dialog-input` (:429 — has `box-sizing: border-box`) | 44 | 8 + 8 | 44px |

The sibling card in the same transcript, `AskUserCard.ts:624`, writes
`button { box-sizing: border-box; min-height: var(--pi-control-height-touch); }` → exactly 44px.
So one affordance ("tap an option to answer") renders at 44px in one transcript card and 60px in the
other, while the rest of the app renders the same token at 32px on a mouse and 44px on a finger.
Inside ExtensionDialogCard the input (44px) and the Send/Cancel row directly under it (60px) disagree
by 16px, which reads as a broken grid rather than as emphasis.

Fix: one line — `box-sizing: border-box` in the `button` rule at :466.

Related, same file: the 44px floor at :526 is unconditional, so the `@container (max-width: 580px)`
copy (:529) and the `@media (pointer: coarse)` copy (:540) are both no-ops, and the comment at :537-539
justifies them by pointing at "the 42px desktop rule" that no longer exists in the file. One owner
should remain.

## B2 · MachineDialog hint text is ellipsis-clipped — HIGH

`pi-web-plugins/machines/browser/MachineDialog.ts` adopts `host.listStyles`, and
`src/client/src/components/shared.ts:449` carries
`small { display: block; … overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`.
`.hint` in MachineDialog overrides colour only, so its sentences lose their tails — e.g. line 118,
"Paste only the token value; PI WEB sends it as an Authorization: Bearer header." is far wider than
the dialog and renders as "Paste only the token value; PI WEB sen…". Hints are the only place these
forms state a consequence, and the consequence is what gets cut.

`ProjectDialog.ts` met the same shared rule and opted out locally (`small.hint { white-space: normal }`);
MachineDialog never did. Root-cause fix: drop `white-space: nowrap` from `listStyles` (a two-line
`small` is the normal case in list rows, and the two places that genuinely need one line are tab
labels and search-clear, which already declare it themselves — shared.ts:166/173/184). Caller-local
fix if the shared sheet must not move: the same two properties on `.hint`.

## B3 · SessionCleanupDialog raises its buttons to 44px and leaves the input behind — HIGH

`src/client/src/components/SessionCleanupDialog.ts:250-253`:

```
@media (pointer: coarse) {
  button { min-height: var(--pi-control-height-touch); }
  .close-button { width: …; height: …; }
}
```

`input.days` (:222) is not in that list, so on a phone the days field measures ~36px in the same row
as two 44px actions; on a mouse it is 36px beside 36px buttons, which is why nobody noticed. The
file's own comment claims "Coarse pointers get the comfort floor, as every sibling dialog does", and
ProjectDialog (:360-366), MachineDialog (:152) and SessionRenameDialog (:41) do raise their inputs.
This is the one dialog where the floor was applied to the label `button` and not to the field a
finger has to hit. Fix: add `input` to that media block.

Same file, two scale escapes: `tbody tr.unselected { opacity: .58 }` (:238) hand-tunes a dim that
`--pi-disabled-opacity` (.55) already owns everywhere else; `.selection-controls button { min-height:
…touch }` (:232) is a dead duplicate of :251.

## B4 · The dialog header is hand-written 8 times at 3 different paddings — MEDIUM/HIGH

`ModalSurface` is the shell that exists to own dialog chrome, and it styles no header at all. So each
dialog writes the rule itself, and the copies have drifted:

| surface | header rule | row height |
|---|---|---|
| ModelPicker:279, CommandPicker:106, AuthDialog:266 | byte-identical, `padding: var(--pi-space-6)` | 69px |
| SessionRenameDialog:29, ProjectDialog:330, MachineDialog:134 | same + `gap: space-4`, `padding: space-6` | 69px |
| SessionCleanupDialog:211 | `gap: space-6`, `padding: var(--pi-space-7)` | **77px** |
| QuickSwitcher:399 | grid, `padding: var(--pi-space-5)` | **57px** |
| AskUserCard:486 | `min-height: 22px`, `padding: space-4 … space-3` | **37px** |
| ExtensionDialogCard:355 | `min-height: 22px`, `padding: space-4 … space-4` | **39px** |

(Row = 36px close button or title line + padding + 1px border; the two transcript cards have no close
button, so their 22px literal sets the row.) The same rule, the same 36px close button and the same
1px bottom border therefore produce 57, 69, 77, 37 and 39px headers across one family, and the two
values that differ by 2px are the pair that sit adjacent in the same transcript. Meanwhile
`--pi-panel-header-height: 44px` is defined and unused in this lane.

Fix: move the header (and footer) rule into ModalSurface once, keyed to `--pi-panel-header-height`,
and delete the eight copies; the two transcript cards adopt the same row instead of the `22px` literal.

## B5 · One primary action, three recipes — MEDIUM

House recipe, 6 files: `border-color: var(--pi-accent); background: var(--pi-accent);
color: var(--pi-on-accent)` — AskUserCard:636, ExtensionDialogCard:482, SessionRenameDialog:38,
SessionTreeNavigator:607, ProjectDialog:382, MachineDialog:147.

Two forks inside the same dialog family:

- `settings/SettingsGeneralPanel.ts:288`, `settings/SettingsShortcutsPanel.ts:355` —
  `background: var(--pi-selection-bg); color: var(--pi-text-bright)` (navy fill, keeps the *accent* border)
- `AuthDialog.ts:290` — `border-color: var(--pi-success-border); background: var(--pi-success-surface);
  color: var(--pi-success)` (green fill)

All three clear AA (7.49 / 13.67 / 6.06), so this is identity drift, not legibility: the same
"Save"/"Add" verb has three bodies depending on which dialog you happen to be in. Keep the accent
fill, delete the other two declarations.

## B6 · Dialog chrome copied three times, twice dead — MEDIUM

`dialog.attachment-zoom` + `.attachment-zoom-full` + `.attachment-zoom-close` (7 rules) exist
byte-identical (`diff` empty) in three places:

- `src/client/src/components/shared.ts:155-161` (inside `workspacePanelStyles`)
- `src/client/src/components/shared.ts:239-245` (inside `listStyles`)
- `src/client/src/components/PromptEditor.ts:47-53` ← the only root that renders the markup

`listStyles` is what ProjectDialog, MachineDialog and the other sheets adopt, so every one of them
ships a dead image-zoom dialog; any retune has to be made three times and two copies will silently
drift. Fix: keep PromptEditor's, delete both shared copies. (ChatView has a parallel live copy,
`.image-zoom-close` at ChatView.ts:1176 — worth folding into the same owner while this is being cut.)

Also in that block: `.attachment-zoom::backdrop { background: rgba(0, 0, 0, 0.8) }` is the only scrim
in the app that ignores `--pi-overlay`, and `.attachment-zoom-close` is fixed at 44px for every
pointer while the whole dialog family runs comfort-36 rising to 44 on coarse. Possibly deliberate for
a top-layer image view; one comment either way.

More dead chrome, same class as the round-12 shell-chrome cleanup — no markup in either shadow root
uses these: AskUserCard `.close-button`, `.icon-button`, `.dismiss-button`, `.status-dot`;
ExtensionDialogCard the same four plus `.closed-summary` (:486-493, replaced by `.answered-row`).

## B7 · AskUserCard's raised card eats its own small text — MEDIUM

`.card { background: var(--pi-surface-raised) }` (AskUserCard:479) makes this the one surface in the
lane that is not `--pi-surface`/`--pi-bg`, and the small text on it is the least legible in the lane:

- `--pi-muted` on surface-raised = **3.62:1** at `--pi-text-2xs` 11px (`.option-detail`,
  `.record-summary`, neutral `.header-status`)
- `--pi-success` on surface-raised = **4.32:1** (`.question-number.answered`)

The neutral-muted miss was measured and retired earlier; the new half is `.question-number.answered`,
which turns the "1." numeral green to signal "answered" — a bare digit carrying state, under AA, while
the same fact is already carried twice by the radio check mark and by the header dot plus
"1 of 3 answered". Fix: delete the colour rule and let the marks carry it — deletion also removes the
only state indicator in the card that is not a mark.

## B8 · Same row, two different status treatments — LOW

`settings/SettingsShortcutsPanel.ts:385-387`: `.shortcut-status small.conflict` gets a pill
(`border: 1px solid currentColor; border-radius: var(--pi-radius-pill); padding: --pi-space-1 --pi-space-4`)
while `.custom` and `.disabled` in the same flex row are bare tinted text at the same size. Three
status labels of equal rank, one of them boxed. Either all three are chips or none is.

---

## 顺手清单 (one line each)

- `ExtensionDialogCard.ts:429` `width: calc(100% - 32px)` — the 32 is two `--pi-space-7` margins
  spelled by hand on a grid item that would get the right box from stretch.
- `QuickSwitcher.ts:511-512` footer: `padding: space-5`, full-width buttons at an unconditional
  `min-height: var(--pi-control-height-touch)`, `border-radius: --pi-radius-lg` — touch-first shape on
  the desktop sheet, while every other sheet's footer is space-6 / 32-36px right-aligned / radius-md.
- `settings/SettingsAppearancePanel.ts` `.theme-scheme { min-height: calc(2 * 1.4em) }` reserves
  30.8px for labels that are one line except for the rare " · chosen, but following your system";
  grid stretch already aligns tiles per row, so this is ~15px of dead air under every label.
- `settings/SettingsAppearancePanel.ts:145` `.preview` hardcodes `height: 74px` (off the space scale)
  and its inner radius is dead arithmetic: `max(var(--pi-radius-xs), calc(var(--pi-radius-lg) -
  var(--pi-space-5)))` = max(4, 12−10) — the `calc` can never win, so it always resolves to 4px. It is
  hand-rolling the "one step tighter" corner token that `--pi-radius-xl`'s comment in
  `src/client/index.html` also describes but which was never added (ChatPane hardcodes the same idea as
  a literal 11px). Add `--pi-radius-inner: 11px` and all three sites become one-token lines.
- No dialog size token exists, and the shell's own hook has two competing override mechanisms:
  `--modal-surface-width` (SessionCleanupDialog:210, SettingsDialog:762) vs styling `modal-surface`
  directly (ModelPicker, CommandPicker, SessionRenameDialog:27, AuthDialog, QuickSwitcher). Result:
  560 / 620 / 720 / 760 / 980 with no shared step and no way to tell which value is a decision.
- `, 44px)` / `, 720px)` fallbacks: `var(--pi-control-height-touch, 44px)` appears in 10 rules across
  5 files though the token is defined unconditionally in `src/client/index.html` — dead weight that
  will outlive its usefulness.
- Ten files restate the same three-line coarse-pointer raise (`min-height`/`width`/`height` at touch).
  That block wants the treatment `settingsControlStyles` got: one shared sheet, callers delete copies.

## Checked and clean (do not re-audit in this lane)

- **Close glyph geometry is uniform**: `×` at `var(--pi-text-xl)` (20px) inside a 36px box rising to
  44px on coarse, in all nine sheets that have one (ModelPicker:286, CommandPicker:112, AuthDialog:273,
  SessionRenameDialog, QuickSwitcher, SessionCleanupDialog, SettingsDialog, ProjectDialog:377,
  MachineDialog:146). No outlier. (The AskUserCard/ExtensionDialogCard close rules are dead CSS — B6.)
- ModalSurface: focus trap, Escape routing, initial-focus selector, `section[role="dialog"]`
  background, backdrop, width/max-height hooks — coherent.
- `settingsControlStyles` (22 lines) supplies `box-sizing: border-box`, `min-height: 32` and the coarse
  44 floor for `button`/`input`/`select`; no settings panel re-declares `min-height` on `button`, so
  the floor survives the cascade everywhere it is adopted. SettingsShortcutsPanel is fine on heights.
- AskUserCard box model is correct (`box-sizing: border-box` on `button`, `.option`, `input`); its
  option rows are exactly 44px. Its two coarse media blocks are no-ops because the base already carries
  the touch floor — dead rules, correct behaviour (the comments even say the base is unconditional).
- ModelPicker / CommandPicker / QuickSwitcher agree with each other on row heights, search-field
  height, glyph size and coarse raise; nothing new beyond B4 and the QuickSwitcher footer note.
- ExtensionDialogCard settled row (`.answered-row`) geometry, single-line ellipsis, countdown header
  status, and `--pi-dot-sm` on `.header-status::before` are all coherent with the token contract.
