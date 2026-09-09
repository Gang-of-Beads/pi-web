# Round 11 — Lane B: pickers, dialogs, sheets

HEAD `843e103e`, branch `refactor/plugin-architecture`. Every line number below was read
in this run. Numbers are computed from the token values in `src/client/index.html`
(space-4 8 / space-5 10 / space-6 12 / space-7 16, text-2xs 11 / text-sm 13 / text-base 14 /
text-md 15 / text-lg 17 / text-xl 20, control-height 32 / -comfort 36 / -touch 44,
row-min-height 56, dot-xs 4 / -sm 6 / -md 8).

Scope audited line-by-line: `ModelPicker.ts`, `CommandPicker.ts` (the thinking picker —
`PiWebApp.ts:3806` renders `state.thinkingDialog` through `<command-picker>`),
`QuickSwitcher.ts`, `ModalSurface.ts`, `SettingsDialog.ts`, `SettingsAppearancePanel.ts`,
`SettingsPanelFrame.ts`, `settingsControlStyles.ts`, `AuthDialog.ts`, `SessionRenameDialog.ts`,
`SessionCleanupDialog.ts`, `SessionTreeNavigator.ts`, `ExtensionDialogCard.ts`,
`pi-web-plugins/workspaces/browser/ProjectDialog.ts` (the add-project dialog), plus
`shared.ts`, `sessionStateBadgeStyles.ts`, `disclosureIcon.ts`, `themeCardLabel.ts` and the
five mechanical guards.

TOTAL: 9 findings.

---

## F1 The add-project dialog ships four control heights because its footer floor is a content box

- `pi-web-plugins/workspaces/browser/ProjectDialog.ts:376` (`button { padding: var(--pi-space-4)
  var(--pi-space-5); border: 1px solid ... }` — no `box-sizing`) and `:337`
  (`footer button { min-height: var(--pi-control-height); }`)
- surface: add-project-dialog
- finding (geometric): `min-height` is measured against the **content box** on a content-box
  element. `footer button` therefore floors at 32px of *content*, and the padding and border from
  the `button` rule are added on top: 32 + 8 + 8 + 1 + 1 = **50px rendered**, where the token says
  32. On a coarse pointer `:360`/`:366` raise the floor to 44 → **62px rendered**. Nothing in the
  file sets `box-sizing` on `button` or `footer button` (only on `input` at `:334`, `.check input`
  at `:336`, `.suggestions button` at `:340`, `header button` at `:377`), and a document-level
  `* { box-sizing }` never crosses a shadow boundary.
  The same dialog therefore renders four heights for one-intent controls: text field **32**
  (`:334`, border-box), suggestion rows **32** (`:340`, border-box), close control **36** (`:377`,
  border-box), footer buttons **50** (62 on a phone).
  Because `header` and `footer` share one rule (`:330`, `padding: var(--pi-space-6)`, 1px rule),
  the dialog draws a **61px header against a 75px footer** on a mouse (61 vs 87 on a phone) from
  box model alone.
- why the guards miss it: `boxModelGuard.test.ts` matches per rule. Rule `:337` has the control
  floor but no padding; rule `:376` has the padding but no floor. Neither rule is individually
  guilty. This is the same defect class round nine named and claimed to have closed ("declared 44
  and drew 62") — that instance was same-rule, so the guard was written for same-rule only.
- minimal failure scenario: open Add project on a phone. Cancel and Add project are 62px tall in a
  dialog whose fields and suggestion rows are 44px, and whose footer is 43px taller than its header.
- confidence: high (arithmetic on declared values; box model is not UA-dependent).

## F2 The dialog close control is still two sizes on a mouse; three pickers were left behind by the round-ten sweep

- 32px: `src/client/src/components/ModelPicker.ts:286`, `src/client/src/components/CommandPicker.ts:112`,
  `src/client/src/components/AuthDialog.ts:273`
- 36px: `QuickSwitcher.ts:403`, `SettingsDialog.ts:767`, `SessionCleanupDialog.ts:244`,
  `SessionRenameDialog.ts:37`, `SessionTreeNavigator.ts:538`,
  `pi-web-plugins/machines/browser/MachineDialog.ts:146`, `pi-web-plugins/workspaces/browser/ProjectDialog.ts:377`
- surface: model-picker, thinking-picker, boot, and every dialog
- finding (geometric): round ten lane B recorded "ten dialogs split their close control between 32
  and 36 … one value now", but the sweep converted the plugin dialogs and the four client dialogs
  and stopped there. All eight controls draw the same glyph `×` at the same
  `font-size: var(--pi-text-xl)` (20px) in the same header slot at the same corner; three of them
  put it in a 32px box and five-plus put it in a 36px box. Clearance round the glyph is **6px vs
  8px**; hit area **1024px² vs 1296px²** — the same verb, 21% smaller, in the pickers.
  On a touch pointer all of them reach 44px, so this is invisible to any phone-only check.
- minimal failure scenario: open Settings, then open the model picker from inside it.
  `PiWebApp.ts:3806` renders `<model-picker ?abovedialog=${this.settingsOpen}>`, so for the whole
  time the picker is open the top-right corner of the sheet behind it holds a 36px `×` and the
  picker holds a 32px `×`, 24px apart, at the same glyph size.
- confidence: high (both sets read in this run; the co-occurrence is wired in the app shell).

## F3 The quick switcher reserves a menu column on rows that have no menu button

- `src/client/src/components/QuickSwitcher.ts:411` —
  `padding: var(--pi-space-5) calc(var(--qs-menu-size) + var(--pi-space-2)) var(--pi-space-5) var(--pi-space-6)`
- markup: `:121-123` (`button.row.workspace-row`) and `:164-171` (`button.row.create-row`) — neither
  renders a `.row-menu-toggle`; only `renderSessionRow` does (`:214-221`)
- surface: quick-switcher
- finding (geometric): the reserve is declared on the shared `.row` class, so `.workspace-row` and
  `.create-row` pay **36px of right padding** on a mouse (44 + 4 = **48px** on a phone, since
  `--qs-menu-size` is raised at `:392`) for a button that is not in their box. Their left inset is
  `--pi-space-6` = 12px, so the label of every workspace row and of "+ New session" sits in a box
  that is 12px from one edge and 36px (48px) from the other, and clamps 24px (36px on a phone)
  earlier than it needs to. `.rename-row` overrides the padding back to symmetric at `:501`, which
  is the proof that the reservation is per-row, not inherent to `.row`.
- minimal failure scenario: open the switcher with any workspace whose label is longer than the
  tile’s first line — the ellipsis arrives 24px before the border on the right and the text
  starts 12px in from the left.
- confidence: high.

## F4 `.theme.active` overwrites `.theme.selected`: the card you picked *and* are running loses its selection border

- `src/client/src/components/settings/SettingsAppearancePanel.ts:128` (`.theme.selected {
  border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent) inset; }`) and
  `:131` (`.theme.active { border-color: var(--pi-border-strong, var(--pi-muted)); }`), classes
  applied together at `:67`
- surface: settings-appearance
- finding (geometric): the two selectors have identical specificity (0,2,0) and `.active` comes
  later in source order, so in the combined state — which is the normal state, since picking a
  theme applies it — **`.active` wins and the accent border is replaced by `--pi-muted`**
  (`--pi-border-strong` is not defined by the shell, so the documented fallback at `:131` is the
  value that renders). The only thing that survives is the inset ring, which is drawn directly
  inside the border. The card edge is therefore **1px grey + 1px accent at zero separation**
  (a two-tone 2px edge), while the card you picked but are *not* running
  (`autoOverriding`, `themeCardLabel.ts:15`) draws **1px accent border + 1px accent ring = a solid
  2px accent edge**. Adding a true fact makes the primary affordance worse, and a card that is
  merely "in use" is now one grey line away from the card that is both chosen and live.
- minimal failure scenario: Appearance panel, any theme that is both selected and rendering. The
  card that is supposed to be the loudest one in the grid has a grey outer line.
- confidence: high (cascade is deterministic; `--pi-border-strong` confirmed undefined in
  `index.html` and recorded as an exempted fallback in `tokenReferences.test.ts:22`).

## F5 Three pickers, three search fields, three heights — two of them set by the browser stylesheet

- `QuickSwitcher.ts:400` — `input { box-sizing: border-box; height: var(--pi-control-height-comfort); }`
- `ModelPicker.ts:287` — `input.search { box-sizing: border-box; padding: var(--pi-space-4)
  var(--pi-space-5); font: var(--pi-control-font-size, 16px) ... }` — **no height**
- `CommandPicker.ts:113` — same declaration as ModelPicker, again **no height**
- surface: model-picker, thinking-picker, quick-switcher
- finding (geometric): the quick switcher pins its field to exactly **36px**. The two pickers leave
  the height to the content box, which is the **UA `normal` line-height** of a 16px field: about
  19px on macOS SF (≈ 37px with 8+8 padding and 1+1 border), about 21px on Windows Segoe UI
  (≈ 39px). The search field of the sheet the user opens with the same shortcut is 1–3px
  taller or shorter depending on the operating system, and is on no rung of the control scale.
  The same control also splits its corner: `--pi-radius-lg` (12px) in the quick switcher against
  `--pi-radius-md` (8px) in both pickers.
- why this was not caught: `radiusScale`/`controlHeightScale`/`spacingScale` are per-declaration
  scanners; a height that is never declared cannot be matched by any of them. Round three recorded
  "three pickers share one search field whose height no longer depends on the browser’s
  stylesheet" — only the quick switcher was given one.
- minimal failure scenario: same build, macOS and Windows: the model picker sheet is 2px taller and
  its search field does not match the row-height rhythm below it.
- confidence: medium-high (the 36px is certain; the other two are certain to be
  `line-height: normal`-derived, so the exact figure is platform-dependent).

## F6 The `main` chip is still inside the two-line clamp that round four said it had been taken out of

- `src/client/src/components/QuickSwitcher.ts:122` (`<span class="row-title">${workspace.label}
  ${isMain ? html`<span class="row-tag" …>main</span>` : nothing}</span>`) and
  `:420` (`.row-title { … display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden }`)
- surface: quick-switcher
- finding (geometric): the comment at `:496-498` states the defect exactly — "· main was
  prose inside a two-line clamp, so the state it carried was the first thing a long workspace name
  cut off" — and the fix (`round four: workspace main is a tag`) changed the chip’s
  typography at `:498` without changing its **containing box**. `.row-tag` is still an
  `display: inline-block` child of the element carrying `-webkit-line-clamp: 2` and
  `overflow: hidden`, so it is laid out in the same clamped inline run and is discarded by the
  clamp exactly as the prose was. Secondary: the chip’s ground is `--pi-selection-bg`
  (#0d2847) on a card whose ground is `--pi-surface` (#161b22) — **1.16:1**, and **1.02:1**
  against `--pi-surface-hover` while the row is hovered, so the pill shape carries no signal at all
  and only the brighter text does.
- minimal failure scenario: a workspace whose label fills two lines in a 140–240px tile (phones
  get `minmax(140px, 1fr)` at `:496`, about nine characters a line). The "main" badge is the first
  casualty, which is the same failure the comment says was fixed.
- confidence: high for the clamp (structure + declaration), medium for the tint figure
  (WCAG non-text 3:1 applied to a state chip’s ground).

## F7 The theme card’s one-line clamp truncates the sentence that exists to be read

- `src/client/src/components/settings/SettingsAppearancePanel.ts:137` (`.theme-scheme { …
  -webkit-line-clamp: 1; overflow: hidden; }`, `font-size: var(--pi-text-2xs)` = 11px at `:134`),
  text produced by `:73` + `src/client/src/themeCardLabel.ts:15`
- surface: settings-appearance
- finding (geometric): the card grid is `minmax(180px, 1fr)` (`:124`, `minmax(150px, 1fr)` below
  760px at `:157`); after `padding: var(--pi-space-5)` and a 1px border the text box is
  **158px** (and 128px on a phone). The suffix the feature added is
  `" · chosen, but following your system"`, which with the mandatory scheme word in front of
  it is `"Dark · chosen, but following your system"` — 40 characters, roughly 220px at
  11px. One clamped line shows about 28 characters, so the card reads
  **"Dark · chosen, but following y…"** — the clause that carries the fact
  ("…your system", i.e. *changing this does nothing until you clear Follow the system*) is
  precisely what is cut. The line is pinned to one row by `min-height: calc(1 * 1.4em)` so the
  reader never even sees it wrap.
- minimal failure scenario: Settings → Appearance with "Follow the system" on: the selected
  card’s explanation is truncated at the point where it stops explaining.
- confidence: high on the geometry, medium on the exact break point (glyph metrics vary).

## F8 Settings types the back verb (`‹`) in the same file that draws the forward verb as SVG

- `src/client/src/components/SettingsDialog.ts:207` — `<button class="settings-back" …>‹
  Settings</button>`; compare `:197` —
  `<span class="settings-list-chevron">${renderDisclosureIcon(true)}</span>`
- surface: settings
- finding (geometric): round ten lane A made "one disclosure verb, drawn once" the rule and lane C
  converted this dialog’s drill-in (the `›` that `:197` now renders as the shared 16×16
  SVG chevron from `disclosureIcon.ts`). The mirror verb, ten lines away in the same template, is
  still the character U+2039 at `font-size: var(--pi-text-base)` with `font-weight: semibold`,
  riding the text baseline of a 14px/1.4 line. Two opposite directions of one verb, two glyph
  systems, one file: the chevron is a 16px geometric mark whose optical centre is its box, the
  `‹` is a font artefact whose height and side bearing come from whatever face supplies it.
- secondary, same control: `.settings-back` at `:796` carries
  `min-height: var(--pi-control-height-touch)` (44px) with no pointer condition, while its sibling
  in the same header row, `.close-button` at `:767`, is 36px and only reaches 44px under
  `(pointer: coarse)` at `:779`. The phone block sets `.settings-header { align-items: flex-start }`,
  so both boxes top-align: on a **narrow desktop window** (`max-width: 760px`, fine pointer —
  the block’s selector is `(pointer: coarse), (max-width: 760px)`) the back control is 44px and
  the close is 36px, putting their glyphs **4px apart on the vertical centre line** the row claims
  to share. This is the residual of round one’s C-F4, which was closed on the coarse branch only.
- confidence: high (both declarations read in this run).

## F9 Pinned is still a typed character, and the only one of its kind left in a quick-switcher tile

- `src/client/src/components/QuickSwitcher.ts:210` —
  `<span class="pin-mark" title="Pinned" aria-label="Pinned">${"⚑"}</span>`;
  the entire style is `:495` `.pin-mark { color: var(--pi-accent); }`
- surface: quick-switcher
- finding (geometric): every other state in the same tile is drawn — `.row-flag` is a 8px
  circle (`:432`), `.row-state` renders the drawn session indicator (`:212`, styled at `:430-431`), `.row-tag`
  is a drawn pill (`:498`). Pin is a bare U+2691 with **no `display`, no `font-size`, no
  `line-height`, no width**: it is `--pi-text-md` (15px) on a 1.3 baseline inside a
  `-webkit-line-clamp: 2` box, and U+2691 is not in the `--pi-font-ui` stack’s primary faces,
  so its advance width, weight and baseline come from a symbol-font fallback, not from the scale.
  Round ten lane C swept the last four typed marks (dictation, prompt history, bulk selection,
  settings drill-in) and did not reach this one.
- minimal failure scenario: a pinned session on a platform whose U+2691 fallback sits 1–2px
  high or renders heavier — the mark visibly breaks the baseline of the title it is inlined
  with, and it consumes glyph width from the session name on line 1 of the clamp.
- confidence: medium-high (the structural claim is certain; the metric drift is platform-dependent).

---

## Checked and deliberately not reported

- **QuickSwitcher state-mark centring** (`.row-flag, .row-state … right: calc((var(--qs-menu-size)
  - var(--pi-dot-md)) / 2 - 1px)`, `:430`): the `-1px` is correct, not a double compensation.
  The mark’s containing block is `.row`’s padding box, which is inset by its 1px border,
  while `.row-menu-toggle` is positioned against `.row-wrap` (no border). Solving both: mark centre
  = `right edge - qs-menu-size/2` = menu-button centre, exactly, at both 32px and 44px. Round ten
  lane B already removed the wrong term.
- **`.row-menu-toggle` vertical centring**: a `<button>` with a single glyph centres its content
  in Blink’s own layout; `place-items` is not required and the 36px box is square.
- **`--pi-dim` at 4.12:1 on `--pi-bg` / 3.77:1 on `--pi-surface`** (measured again this round):
  still failing AA as text, but no in-lane surface uses it for text any more — remaining
  users are `::placeholder`, tool diffs, git gutter, composer hints and dots. Out of Lane B.
- **Close family on a touch pointer**: all eight controls reach 44px, including the three missed
  pickers (`ModelPicker.ts:295`, `CommandPicker.ts:125`, `AuthDialog.ts:274`). F2 is a mouse-only split.
- **`⋯` as the row-overflow glyph**: the house pattern (`shared.ts:435`, SessionList,
  MachineList, WorkspaceList, ProjectList, MachineSwitcher, QuickSwitcher). The size difference
  (`--pi-text-lg` 17px in QuickSwitcher `:467` versus an inherited 14px in `shared.ts`) is already
  carried by lane C’s round-five open item on `⋯`/`×`, so it is not raised twice.
- **`.preview { height: 74px }`** (`SettingsAppearancePanel.ts:145`): off both the spacing and the
  control scale, but it is artwork, it is `box-sizing: border-box`, it is now honest (round nine
  fixed the 74-vs-92 case) and every guard deliberately stops at 44px. Reported nowhere.
- **Dark-theme contrast on the fills this lane owns** — accent on `--pi-selection-bg` 5.89:1,
  muted on selection 4.84, muted on surface 5.62, muted on surface-hover 4.95, warning on
  `--pi-warning-surface` 6.86, danger on selection 5.90: all clear AA 4.5:1. No in-lane fill fails.
