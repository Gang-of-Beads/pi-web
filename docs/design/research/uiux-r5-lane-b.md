# UI/UX Round 5 — Lane B: pickers, dialogs, sheets after the scale work

Scope: new findings only, after rounds 1–4 (through `509bfcf0` "Guard token references…" and
`d1c2e9bf`). Surfaces read at HEAD: ModelPicker, CommandPicker, ActionPalette, QuickSwitcher,
AuthDialog, AskUserCard, ExtensionDialogCard, ModalSurface, SessionRenameDialog,
SessionCleanupDialog, SessionTreeNavigator, SettingsDialog + all `settings/*` panels,
SettingsPanelFrame, ContextSwitcherSheet, AutocompleteMenu, PromptHistoryPanel, shared.ts,
pi-web-plugins `ProjectDialog.ts` / `MachineDialog.ts`.
Guard tests re-read: spacingScale, controlHeightScale, typeScale, dotScale, radiusScale,
tokenReferences. Everything below was checked against `uiux-lane-b.md` (r1), `uiux-r2-lane-b.md`,
`uiux-r3-lane-b.md`, `review-triage-uiux-rounds-2-3.md`, and the round-4 changesets; prior
findings and their verdicts are listed as carryovers in the appendix, not re-reported.

Verdict: 6 new findings. Two of them (B1, B2) are members of already-closed families that the
round-2/round-4 fix passes visibly skipped — the same failure mode r1 F2 named ("the per-component
sweep missed real buttons twice").

---

## B1. The ⌘K action palette and the auth dialog still render their button labels in the UA default font — the C-F2 fix never reached them

Severity: high (⌘K is the highest-traffic surface in this lane). 判定: true.

- `src/client/src/components/ActionPalette.ts:108` `button { border: 0; background: transparent; color: var(--pi-text); cursor: pointer; }` — no `font`
- `src/client/src/components/ActionPalette.ts:112` `.options button { display: grid; … padding: var(--pi-space-5) var(--pi-space-6); … }` — no `font`
- `src/client/src/components/AuthDialog.ts:272` base `button { … }` — no `font`; `:288` `.actions button, .inline-options button { … }` — no `font`; `:273` `header button { font-size: var(--pi-text-xl); … }` sets only size, so the `×` glyphs at the UA family/weight too
- No global reset exists: `interactiveSurfaceStyles` (`shared.ts:17-35`) only sets `-webkit-tap-highlight-color` and `touch-action`; `index.html:199`'s comment — "The per-component sweep missed real buttons twice; the root rule cannot miss" — pins only the tap highlight, not the font. `<button>` does not inherit.

Sibling evidence (the house pattern, twice published):
- `ModelPicker.ts:293` and `CommandPicker.ts:110` — `.options button { … font: var(--pi-text-sm)/1.25 var(--pi-font-ui); … }` — this is the r2 C-F2 remedy ("picker 行落回 UA Arial 13.33px" → triaged **true**, fixed there);
- `SessionCleanupDialog.ts:240`, `SessionRenameDialog.ts:36`, `AskUserCard.ts:620`, `ExtensionDialogCard.ts:470`, `QuickSwitcher.ts:411` — `font: inherit` on the button base.

Minimal failure scenario: the actions plugin (`plugins/core/actions.ts:15`) opens `<action-palette>`
(`PiWebApp.ts:3851`). Its row titles (`strong`) and subtitles inherit the UA default
(~13.33px Arial-family regular) — off the type scale (no 13.33 token), off `--pi-font-ui`, and one
weight step below every other picker row the same key chord sequence reaches. Two adjacent
keyboard surfaces, two type systems.

Why guards miss it: `typeScale.test.ts` scans CSS literals for sizes off the ramp; a *missing*
declaration that falls back to the UA is invisible to a literal scanner.

Minimal fix: ActionPalette `button { … font: inherit; }` (rows then pick up `:host`'s
`var(--pi-text-base) var(--pi-font-ui)`; if the C-F2 row spec is preferred, copy
`font: var(--pi-text-sm)/1.25 var(--pi-font-ui)` from `CommandPicker.ts:110`). Same one-liner in
`AuthDialog.ts:272`.

---

## B2. Round 4's "dialog close controls agree on a mouse size" pass left three surfaces out

Severity: medium. 判定: true.

`509bfcf0` states the law and converts one member (`SessionRenameDialog` header button → 32px
grid box). The compliant shape — `display: grid; place-items: center; width/height: <control
token>; padding: 0; line-height: 1` plus a `pointer: coarse` bump to 44 — now exists in:
- 32px fine / 44 coarse: `ModelPicker.ts:280,288`, `CommandPicker.ts:106`, `SessionRenameDialog.ts:37,41`
- 36px fine / 44 coarse: `SettingsDialog.ts:766,778`, `SessionCleanupDialog.ts:244,251`

Holdouts:
- `AuthDialog.ts:273` — `header button { font-size: var(--pi-text-xl); color: var(--pi-muted); }` only. No box, no `line-height: 1`, no `place-items`: the button keeps **UA default padding (1px 6px)** and puts the 20px glyph on the baseline; nothing centres it and there is no coarse rule in the file at all.
- `ActionPalette.ts:109` — `padding: var(--pi-space-1) var(--pi-space-4)`, no line-height reset → ~24px tall; the file's only coarse block (`:126`) hides `kbd`, never touches the close.
- `QuickSwitcher.ts:403` — `font-size: var(--pi-text-xl); line-height: 1; padding: 0 var(--pi-space-4)` → a **20×36 box on fine pointers**; it is raised to 44 only inside `@media (pointer: coarse)` (`:485`). On desktop the × next to the 32px search field is a 20px target; on the same surface r3 B7's fix shipped.

Minimal failure scenario: desktop users hit × on ModelPicker (32×32, optically centred) and on the
quick switcher (20px tall, glyph bottom-aligned in its line box); on a phone every dialog raises
its close to 44 except ⌘K's palette and the auth dialog, which stay ~24px.

Why guards miss it: the control-height guard only matches 28–44px literals on
width/height/min-height — absent sizing and 20px/24px boxes are below/without its range.

Minimal fix: apply the `ModelPicker.ts:280` declaration (with coarse bump) to these three
selectors; pick the tier (32 picker / 36 dialog) per surface.

---

## B3. Settings panels ship four different checkbox sizes — 14, 16, 18, and a raw 24 — while `--pi-checkbox-size` sits unused by all of them

Severity: medium. 判定: true.

The token exists (`index.html`, `--pi-checkbox-size: 24px`, introduced by round-4 `8e131a16`) and
is read by `ModelPicker.ts:291`, `SessionCleanupDialog.ts:221`, `SessionList.ts:728`. The settings
panel family — one scrollable flow, one row grammar — escaped the migration:
- `settings/SettingsShortcutsPanel.ts:364` — `.prompt-enter-option input { width: 14px; min-width: 14px; height: 14px; … }`
- `settings/SettingsSessiondPanel.ts:144` — `.toggle input { width: 16px; height: 16px; }`
- `settings/SettingsPluginsPanel.ts:218` — `.toggle input { width: 18px; height: 18px; accent-color: var(--pi-accent); }`
- `settings/SettingsAppearancePanel.ts:124` — `.follow input { width: 24px; height: 24px; … }` (right value, raw literal, so the token can no longer be retuned centrally)

None of the four has a `pointer: coarse` bump (files contain only `max-width: 760px` blocks), so
phones get 14–18px checkbox targets where r3 B7's fix raised `SessionCleanupDialog` to
`--pi-checkbox-size` on touch.

Minimal failure scenario: Settings → Daemon shows 16px squares in the `.toggle` row; Settings →
Plugins, the same row grammar a tab away, shows 18px; Settings → Shortcuts shows 14px. The mark an
iOS user must hit differs per panel by up to 10px, and a future token retune moves the pickers
but no settings panel.

Why guards miss it: `controlHeightScale.test.ts` only inspects 28–44px literals (14/16/18 are
below the floor); `dotScale.test.ts` looks for round dots / dot-named selectors; neither knows
what a checkbox is.

Minimal fix: `width/height: var(--pi-checkbox-size)` (with `box-sizing: border-box` as in
`SessionCleanupDialog.ts:221`) in all four rules, or define a smaller `--pi-checkbox-size-inline`
once if 24px is genuinely too big for the shortcut row — but name it, don't quadruple-write it.

---

## B4. `font-weight: 700` survives in eight declarations — the exact drift r2 named `--pi-weight-strong` to kill — and splits two same-role pairs

Severity: medium. 判定: true.

The published scale is 400/500/600/650 (`--pi-weight-regular|medium|semibold|strong`); there is no
700 token. Round 2 fixed 650-literals for cross-platform quantization reasons; the 700s remained:
- `SessionCleanupDialog.ts:214` `.eyebrow { … font-size: var(--pi-text-2xs); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }` and `:239` `tfoot th, tfoot td { … font-weight: 700; }`
- `SessionTreeNavigator.ts:536` (`.eyebrow`, same spec), `:565` (`.kind`), `:578` (`.badge`), `:587` (`legend`), `:606` (`button.primary`)
- `settings/SettingsPackagesPanel.ts:194` `label { font-weight: 700; }`

Role collisions with the token side of the house:
1. Dialog eyebrow: `SettingsDialog.ts:763` = `--pi-text-xs` + `var(--pi-weight-semibold)` (600), no uppercase; `SessionCleanupDialog.ts:214` = `--pi-text-2xs` + 700 + uppercase + `.08em`. Same slot (kicker above the `h1` in a `modal-surface`), two typespecs — settings→cleanup is one click.
2. Primary button: `SessionTreeNavigator.ts:606` = raw 700; `AskUserCard.ts:627` `.primary-action` = `var(--pi-weight-strong)`; `SessionRenameDialog.ts:40` `.primary` = no weight at all. Three renderings of one affordance.

On variable system stacks 650 and 700 quantize differently per platform — the same argument that
triaged r2's weight finding true. Why guards miss it: no guard test reads `font-weight` at all
(grep of the five scale tests: zero matches). Minimal fix: `var(--pi-weight-strong)` for the
primary buttons; pick one eyebrow spec (the uppercase 2xs/strong kicker is the more distinctive
of the two) and reuse it in both dialogs; add `font-weight` to a scale test so it cannot regrow.

---

## B5. The auth dialog is the one dialog in the family with no `pointer: coarse` floor at all

Severity: medium. 判定: true.

`grep -c '@media' AuthDialog.ts` = 1, and it is the `hover: hover` block. Every peer dialog raises
its controls on touch: rename/cleanup/settings/model/command/palette rows all reach
`--pi-control-height-touch` (44) under `pointer: coarse` (see `SessionRenameDialog.ts:41`,
`ModelPicker.ts:287-291`, `QuickSwitcher.ts:484-493`, plugin dialogs `ProjectDialog.ts:375`,
`MachineDialog.ts:151`). In `AuthDialog.ts`:
- `:288` `.actions button, .inline-options button` — `padding: var(--pi-space-4) var(--pi-space-5)`, no min-height → ~37px Cancel/Submit on a phone;
- `:274` `input` — ~37px content+padding, no coarse min-height (peers: `input { min-height: 44 }` in rename, `input.search` bumped in ModelPicker);
- `:273` close — see B2.

This is the dialog that appears for OAuth/token entry on exactly the devices where typing a code
into a 37px field matters, and it breaks r2's fleet rule ("every interactive target 44 on touch")
that rounds 2–4 then implemented on every sibling. Minimal fix: one trailing
`@media (pointer: coarse) { header button {…44} .actions button, .inline-options button, input { min-height: var(--pi-control-height-touch, 44px); } }` block, copied from `SessionRenameDialog.ts:41`.

---

## B6. "Disabled is one token" (round 4) has four holdouts: .6, .65, .65, .68

Severity: low-medium. 判定: true.

`509bfcf0` merged `.5/.52/.55` into `--pi-disabled-opacity` (.55; 19 call sites today). Raw
disabled opacity still lives in:
- `AuthDialog.ts:290` — `.actions button:disabled { opacity: .6; cursor: wait; }`
- `AskUserCard.ts:626` — `button:disabled { cursor: wait; opacity: .65; }`
- `ExtensionDialogCard.ts:476` — `button:disabled { cursor: wait; opacity: .65; }`
- `ActionPalette.ts:114` — `.options button:disabled { cursor: not-allowed; opacity: .68; }`

Five strengths of "off" (.55/.6/.65/.68 plus the `color-mix(... 55%)` companion at
`ActionPalette.ts:115`) now render across the ask/extension/auth/palette surfaces that sit side by
side in one waiting flow. Adjacent note: `SessionCleanupDialog.ts:237` `tbody tr.unselected {
opacity: .58 }` carries a measured rationale comment — if "unselected dim" is a distinct state it
deserves its own named token, not a value 0.03 from the disabled one.

Why guards miss it: no test greps `opacity` (checked all five scale tests + tokenReferences).
Minimal fix: swap the four literals to `var(--pi-disabled-opacity)`; either fold `.58` in or name
`--pi-unselected-opacity`.

---

## Checked, deliberately not reported

Carryovers still open in code (already on record, fixes pending — verified, not re-counted):
- AskUserCard header `padding: var(--pi-space-5) var(--pi-space-6)` vs `--pi-space-7` sides (r3 B5, `AskUserCard.ts:525`);
- ExtensionDialogCard `width: calc(100% - 32px)` / no `min()` (r3 B10, `:423`);
- SessionCleanupDialog selection ~28px vs 38px footer rhythm (r3 B8); `calc(100vh - 40px)` (r3 B6, `:211`);
- SessionRenameDialog `input { font: inherit }` → 14px iOS-zoom field (r3 B9, `:33`).

Judged non-findings this round, with reason:
- `ContextSwitcherSheet.ts:303` close — 44px on all pointers; phone-only surface, matches its own floor.
- `AutocompleteMenu.ts:136` `bottom: calc(100% + 6px)` and `QuickSwitcher.ts:477` `top: calc(100% - 4px)` — positioning offsets (spacing guard's grammar is padding/margin/gap only); 6px is on the scale, and r3 already judged the `-4px` seam deliberate. Class noted under root causes.
- `QuickSwitcher.ts:500` `.row-tag { line-height: 16px }` — the codebase's only px line-height, but there are no line-height tokens to escape; peers hand-write unitless ratios too.
- QuickSwitcher row-menu coarse pass — complete (`.row-menu button` bumped at `:489`); earlier suspicion dismissed.
- `QuickSwitcher.ts:399` interrupted badge `border: 2px` — matches `sessionStateBadge` house geometry.
- Plugin dialogs (`ProjectDialog`, `MachineDialog`) — r1 F fully remediated (touch floors under `pointer: coarse`, `var(--pi-disabled-opacity)`, token focus rings); nothing new.
- ModalSurface / shared.ts / PromptHistoryPanel / SettingsMachinesPanel — read; all size values are tokens or comment-sanctioned (88px/94px card+textarea mins, not controls).
- AskUserCard footer (`gap: space-6`, L609) vs ExtensionDialogCard footer (`gap: space-4`, L455) — the 12px separates an info block from `.step-actions` (whose own gap is space-4 = the extension value); not a sibling break.

## Cross-cutting root causes

1. **Family-wide rules get applied by file enumeration, not by family query.** C-F2 (fonts), the close-control agreement, `--pi-disabled-opacity`, and `--pi-checkbox-size` each landed on the files the fix pass was looking at and missed structurally identical siblings (B1, B2, B3, B6 are all this). A "find every consumer of pattern X" sweep per rule would have caught all four.
2. **Guards check literals, not absences.** Every new finding is either a missing declaration (B1, B2, B5) or a value outside the guard's property/number window (B3 14–18px, B4 font-weight, B6 opacity). The next guard worth writing is *positive-presence*: every `button`-bearing shadow root in `components/` declares a font, every `header button` declares a box, every `:disabled` reads the token.
