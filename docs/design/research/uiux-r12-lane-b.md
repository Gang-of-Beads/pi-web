# Round 12 — Lane B (pickers, dialogs, sheets)

Scope audited: `CommandPicker`, `ModelPicker`, `QuickSwitcher`, `ModalSurface`, `SessionRenameDialog`,
`SessionCleanupDialog`, `SettingsDialog`, `SessionTreeNavigator`(styles), `AskUserCard`,
`ExtensionDialogCard`, `machines/browser/MachineDialog`, `workspaces/browser/ProjectDialog` +
`addProjectDialog`, `sessionRowIndicator` / `sessionStateBadgeStyles`, tokens in `src/client/index.html`.
All line numbers verified against the working tree. Round-1–11 fixes and the recorded deliberate
exceptions were checked first (`git show 964ada31 b3ae9c83`).

---

## B1. `MachineDialog` is the only dialog in the family whose buttons never opt out of the UA font

`pi-web-plugins/machines/browser/MachineDialog.ts:145`

    button { border: …; border-radius: …; background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }

Every sibling dialog carries this same rule **plus `font: inherit`**:
`workspaces/browser/ProjectDialog.ts:376`, `SessionCleanupDialog.ts:240`, `SettingsDialog.ts:766`,
`SessionRenameDialog.ts:36`, `AskUserCard.ts:623`, `ExtensionDialogCard.ts:471`.
MachineDialog is the one copy that dropped it. Consequences, in the same file:

* The footer CTA ("Add machine"/"Cancel") renders in the UA control face (Blink: 13.333px Arial)
  instead of the host's 14px `--pi-font-ui` declared at `MachineDialog.ts:130`. Two different
  typefaces for one CTA pair, at 13.3px vs 14px.
* Height follows the face: ~33px here (15px UA line box + 8+8 padding + 2 border) vs ~35px in
  ProjectDialog/SessionRenameDialog. This is exactly the mismatch the file's own comment at
  `:150-151` describes ("this dialog shipped 33px footer buttons"), but the fix at `:151-154` is
  `@media (pointer: coarse)` only — so on a mouse the 33px/35px mismatch is still on screen, and
  the comment now documents a bug it did not fix.
* `header button` at `:146` sets `font-size: var(--pi-text-xl)` only, so the close `×` renders in
  Arial 20px while every other dialog's `×` renders in the UI face at 20px
  (`SessionCleanupDialog.ts:244` / `SettingsDialog.ts:767` / `SessionTreeNavigator.ts:538` inherit it
  from their base `button { font: inherit }`).

Fix: add `font: inherit` to line 145 — one declaration, removes all four symptoms. Round 11 fixed
this exact class of bug in three picker close controls and the goals refresh button; this file was
missed.

## B2. `SessionCleanupDialog`: the coarse touch floor for the selection buttons is dead on arrival

`src/client/src/components/SessionCleanupDialog.ts:231` vs `:249-252`

    231:  .selection-controls button { box-sizing: border-box; min-height: var(--pi-control-height); padding: var(--pi-space-3) var(--pi-space-4); font-size: var(--pi-text-xs); }
    249:  @media (pointer: coarse) {
    250:    button { min-height: var(--pi-control-height-touch); }

`(0,1,1)` beats `(0,0,1)` regardless of source order or media query, so on a phone "Select all" /
"Deselect all" stay at **32px** while the "Cancel" / "Run cleanup" buttons 20px below them in the
same dialog get **44px**. The author's intent is written at `:247-248` ("this one shipped ~36px
footer actions and **~29px selection controls**"), so the raise was wanted and silently does nothing.
The house rule is stated five times elsewhere — `shared.ts:268`, `:288`, `:335`, `:444`,
`QuickSwitcher.ts:483`, `ChatView.ts:164` ("a media query carries no extra specificity").
This is the one place in the lane where a class-level control floor shadows a coarse floor.
Note this also slips past the round-11 box-model guard, which compares a control floor and padding
*within one selector* and does not model cross-selector specificity.

Fix: raise the same selector inside the media query — `@media (pointer: coarse) { .selection-controls button { min-height: var(--pi-control-height-touch); } }`.

## B3. Two transcript cards, two touch-target policies — and each cites the other

* `AskUserCard.ts:559` gives every `.option` row `min-height: var(--pi-control-height-touch)`
  **unconditionally** (44px at every pointer).
* `AskUserCard.ts:617-628` gives `button` no floor, and `:669-671` raises
  `.primary-action, .secondary-action` **only** under `@media (pointer: coarse)`.

So on a mouse, inside one card: 44px option rows, then a **~35px** "Back / Next / Submit" row under
them. `AskUserCard.ts:666-668` justifies the pointer-scoping by saying "this card's own option rows
already carry 44px unconditionally" — the premise argues for the opposite conclusion.
`ExtensionDialogCard.ts:519-521` reaches the opposite conclusion and cites *this* card as the
precedent ("as the ask-user card beside it in the same transcript already states"), setting
`.primary-action, .secondary-action, .option-button, .dialog-input { min-height: touch }` at every
pointer. The two cards render side by side in the same transcript: **44px vs 35px** action rows,
same role, same scroll position, and both files' comments claim to be following the other.

Fix: delete the media query at `AskUserCard.ts:669-671` and set the floor with the base button rule,
matching `ExtensionDialogCard.ts:521`.

## B4. The two transcript cards' headers are not one pattern

Same shell (`.card`, `--pi-surface-raised`, `--pi-elevation-2/3`, same `min-height: 22px`),
two different headers:

| | AskUserCard | ExtensionDialogCard |
|---|---|---|
| title type | `:501-506` `font: var(--pi-text-xs) var(--pi-font-mono)`, `color: var(--pi-accent)`, `line-height: 1.3` — 12px mono, accent | `:367-374` `font-size: var(--pi-text-base)`, `--pi-weight-strong`, inherited text colour, `line-height: 1.35` — 14px sans |
| header padding | `:495` `var(--pi-space-4) var(--pi-space-7) var(--pi-space-3)` — 8 top / **6 bottom**, asymmetric | `:361` `var(--pi-space-4) var(--pi-space-7) var(--pi-space-4)` — 8 / 8, symmetric |
| header rule colour | `:496` `color-mix(--pi-border-muted 35%, transparent)` | `:362` `var(--pi-border-muted)` |

Header content heights come out ~27px vs ~35px, and the gap between title baseline and the rule
differs by 2px plus the line-height delta. An ask-user prompt and an extension prompt appearing in
one transcript read as two different components. The 12px mono accent title is also the only place
in the lane where a *title* uses the mono face — every other title in every dialog here
(`SessionCleanupDialog.ts:216-217`, `SettingsDialog.ts:765`, the machine/project dialogs'
`<strong>`) is the UI face.

## B5. Every status hue drops under AA on the raised card stop (measured, opaque colours only)

`--pi-surface-raised` is `color-mix(in srgb, var(--pi-surface) 84%, var(--pi-text))`
(`index.html:185`) = **#373d43**. Against that single opaque background:

| foreground | on `--pi-surface-raised` | on `--pi-bg` |
|---|---|---|
| `--pi-warning` #d29922 (`index.html:161`) | **4.35:1** | 7.50:1 |
| `--pi-success` #3fb950 (`:156`) | **4.33:1** | 7.45:1 |
| `--pi-danger` #ff7b72 (`:164`) | **4.36:1** | ~7.4:1 |
| `--pi-accent` #58a6ff (`:150`) | **4.35:1** | ~8.4:1 |

All four sit under the 4.5:1 AA floor, and they are used at 11–12px exactly there:
`AskUserCard.ts:507-509` (`.header-status` at `--pi-text-2xs`, `.submitted`→success,
`.superseded`→warning) and `ExtensionDialogCard.ts:375-377` (`.header-status.answered`→success,
`.timeout/.aborted/.session-ended`→warning). Those status strings are the *only* text that says
"this prompt was answered / timed out", and the card background is declared opaquely at
`AskUserCard.ts:497` / `ExtensionDialogCard.ts:364` — no ancestor opacity, no transparency
chain, no `color-mix` on the foreground: two solid colours, so this is not the multiplied-opacity
case rejected in an earlier round.

The palette hues were tuned against `--pi-bg`/`--pi-surface`; the raised card stop is 16% lighter
and costs ~3 points of contrast. Fix either way: lighten the four hues where they land on
`--pi-surface-raised` (`color-mix(in srgb, var(--pi-success) 80%, white)` style, one derived value
shared by both cards), or raise `.header-status` to `--pi-text-sm` so it qualifies as large-ish text.

## B6. Single-line dialog fields have five different heights on a mouse

| field | rule | rendered height |
|---|---|---|
| Rename-session dialog input | `SessionRenameDialog.ts:33` — no height/min-height, `font: inherit` (14px), `padding: var(--pi-space-4) var(--pi-space-5)` | **~35px** |
| Command-picker search (thinking picker, every extension `pick`) | `CommandPicker.ts:113` — no height, 16px control font, `space-4/space-5` | **~37px** |
| Model-picker search, quick-switcher search + rename input | `ModelPicker.ts:287` (`height: var(--pi-control-height-comfort)`), `QuickSwitcher.ts:400`, `:505` | **36px** |
| Add-machine fields, add-project path field | `MachineDialog.ts:138`, `ProjectDialog.ts:334` — `padding: var(--pi-space-5)` all round, 16px font, no height (ProjectDialog's `min-height: var(--pi-control-height)` is below its own content) | **~41px** |
| Extension-dialog input | `ExtensionDialogCard.ts:424` + `:521` — `min-height: var(--pi-control-height-touch)` | **44px** |

The declared control scale is 32/36/44; 35, 37 and 41 are all line-box accidents from missing
declarations. The two rename entry points for *one task* disagree (36px inline in the switcher vs
35px in the rename dialog), and the two search fields inside one picker family disagree by 1px —
round 11 gave `ModelPicker.ts:287` its comfort height and left `CommandPicker.ts:113`, which is the
same `modal-surface` shell doing the same job, without one.
Fix: `height: var(--pi-control-height-comfort)` on `CommandPicker.ts:113` and
`SessionRenameDialog.ts:33`; decide whether text inputs in dialogs are comfort (36) or a dialog
field token and state it once.

## B7. The rename dialog's input is the only text field in the app under 16px → iOS zooms on focus

`SessionRenameDialog.ts:33` uses `font: inherit` (14px). `--pi-control-font-size: 16px`
(`index.html:135`) exists precisely for this and is read by 18 call sites, including the two
dialogs this one is copied from (`ProjectDialog.ts:334`, `MachineDialog.ts:138`) and its own lane
neighbours (`CommandPicker.ts:113`, `ModelPicker.ts:287`, `SessionCleanupDialog.ts:222`,
`ExtensionDialogCard.ts:433`, `AskUserCard.ts:591`). Below 16px, iOS Safari zooms the viewport when
the field takes focus and does not zoom back out — on the one dialog whose entire job is typing a
name. Fix: same font declaration as `ProjectDialog.ts:334`.

## B8. `.eyebrow` — same class, same role, two renderings (and three tracking values in the lane)

* `SettingsDialog.ts:764` — `font-size: var(--pi-text-xs)` (12px), `--pi-weight-semibold`, **no
  `text-transform`, no tracking** → renders "Settings" in title case 12px. Used three times
  (`:141`, `:171`, `:210`) in the largest dialog in the app.
* `SessionCleanupDialog.ts:214` and `SessionTreeNavigator.ts:537` (identical duplicate) —
  `--pi-text-2xs` (11px), `--pi-weight-bold`, `letter-spacing: .08em`, `text-transform: uppercase`
  → renders "SESSIONS" / "SESSION TREE".
* Third and fourth tracking values for the same uppercase micro-label role elsewhere in the lane:
  `ModelPicker.ts:308` (12px, no weight, `.04em`), `QuickSwitcher.ts:405` (12px, semibold, none),
  `machines/browser/MachineSwitcher.ts:300` (11px, `.02em`).

The dialog kicker above `h1` is one role with one class name; it should read as one thing. There is
no token or shared class for it, so each file re-picks size (11/12), weight (400/600/700) and
tracking (none/.02/.04/.08). Fix: one `--pi-tracking-eyebrow` token + one `.eyebrow` rule (the
duplicated SessionCleanup/SessionTree pair shows how cheap that is to share), and
`SettingsDialog.ts:764` reads it.

## Nits (verified, one line each)

* `QuickSwitcher.ts:435` — `.row-flag.unread` is dead CSS: the only `.row-flag` the template renders
  is `interrupted` (`:212`); unread goes through `renderSessionRowIndicator` → `.session-state.unread`
  (`sessionStateBadgeStyles.ts`). Delete the rule.
* `ExtensionDialogCard.ts:426` — `width: calc(100% - 32px)` hard-codes 2×`--pi-space-7` as a literal
  off the spacing scale (max token is `--pi-space-9` = 24px), while the gutter it must line up with is
  `var(--pi-space-7)` in every neighbouring rule (`:361`, `:380`, `:397`, `:459`, `:483`). Change the
  gutter and the field stops aligning with the message text. `width: 100%` + `margin-inline` reads
  from the token instead.
* `MachineDialog.ts:138` — one `input` rule sets `--pi-control-monospace-font-family` for all three
  fields, so "Machine name" ("a friendlier sidebar label", `:112`) is typed in the code face while the
  equivalent free-text field (`SessionRenameDialog.ts:33`) is in the UI face. URL + token are
  legitimately mono; the name is not.
* `SessionCleanupDialog.ts:220` and `:222` — `88px` is written twice (grid column + input width) for
  one measurement; `:235`/`:260` do the same for the checkbox column (72px / 58px). No token, and a
  change to one copy silently misaligns the row.
* `SessionCleanupDialog.ts:237` — `opacity: .58` is the only opacity literal in the lane outside
  `--pi-disabled-opacity` (`.55`, `index.html:107`). Composite of an unselected row's own text is
  6.09:1, so it is not a contrast failure; it is a scale escape.
* `QuickSwitcher.ts:248-249` — the rename row's confirm/cancel are the typed glyphs `✓` (U+2713) and
  `×` (U+00D7) inside 36×36 boxes (`:507-509`). `×` is the house close glyph everywhere, so it is
  fine; `✓` is the last typed *confirm* mark left in this file after rounds 10–11 converted the rest
  to drawn SVG, and a baseline-sitting glyph in an em box cannot be optically centred in a 36px
  square the way the drawn marks are.

## Checked and clean (so the next round does not re-walk these)

* `QuickSwitcher.ts:432` state-mark centring: `right: calc((var(--qs-menu-size) - var(--pi-dot-md)) / 2 - 1px)`
  — the `-1px` is the row's own 1px border, and the mark's centre lands exactly on the menu button's
  centre line at both 32px and 44px menu sizes. Not a magic nudge.
* `sessionStateBadgeStyles.ts` `.state-dots` (3×4px + 2×2px = 16px) sits inside `.session-state`
  (`display: inline-grid; place-items: center; width: var(--pi-dot-md)`), so it overflows the 8px
  anchor symmetrically — the running mark stays on the same axis as the single dot. Clean.
* `ProjectDialog.ts:334-378` — coarse floors are declared after every base rule they raise, at equal
  or higher specificity; no shadowing. `AddProjectDialog` is a 36-line wrapper with no styles.
* `ModalSurface.ts` — geometry all flows through the `--modal-surface-*` custom properties; the two
  mobile overrides (settings/cleanup/project/machine) are byte-identical values.
* Checkbox sizing is uniform (`--pi-checkbox-size` 18px) in `AskUserCard.ts:567`,
  `SessionCleanupDialog.ts:221`, `ModelPicker.ts:306`, `ProjectDialog.ts:336`.
* `--pi-on-accent` on `--pi-accent` = 7.49:1; `.row-tag` (`--pi-text-bright` on
  `--pi-selection-bg`) = 13.7:1; `.chip` = 9.9:1; `.dialog-error` (danger on 10% danger + bg) =
  6.6:1; the interrupted ring and idle dot clear 3:1 as graphical objects. No filled-control text
  failures left besides B5's status hues.
