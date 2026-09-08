# Lane B — pickers, dialogs, sheets, and the rows inside them

Scope: model-picker, thinking/theme pickers (command-picker), settings, settings-appearance,
quick-switcher, qs-row-menu, add-project-dialog, plus the sibling overlay family they are meant to
match (session-rename, session-cleanup, project-dialog, machine-dialog, machine-switcher,
context-switcher-sheet, session-tree-navigator, ask-user / extension dialogs).
Method: every claim was read out of source at the cited line on `refactor/plugin-architecture`.
Paths are relative to the repo root. Contrast figures are computed from the hex values in
`src/client/index.html:105-140` (±0.1).
Token reference: `src/client/index.html:30-104` — space 2/4/6/8/10/12/16/20/24 · text
11/12/13/14/15/17/20 · radius xs4 sm6 md8 lg12 xl16 pill999 · control-height 32 ·
control-height-touch 44 · layers raised10 sticky20 popover30 overlay40 dialog50 blocking60.

---

## F1 The phone-only Settings branch colours text with a token that does not exist

- `src/client/src/components/SettingsDialog.ts:786` (`--pi-text-muted` on the row description) and `:787` (same token on the `›` chevron)
- The desktop branch of the *same component* uses the real token: `:775` `color: var(--pi-muted)`
- `--pi-text-muted:` is defined nowhere — a grep for the definition across `src/`, `plugins/`, `pi-web-packages/`, `pi-web-plugins/` returns nothing. The real token is `--pi-muted: #8b949e` (`index.html:115`).
- Same undefined token also reaches `src/client/src/components/ChatView.ts:271`.

Surface: Settings → the full-screen phone/tablet settings list (branch at `:778`
`@media (pointer: coarse), (max-width: 760px)`).

An unresolved `var()` without a fallback makes the declaration invalid at computed-value time, so
`color` falls back to the inherited value — `:host { color: var(--pi-text) }` (`:760`, `#e6edf3`).

Minimal failure scenario: open Settings on an iPhone. Every row stacks a 16px/600 title (`:785`)
over a 13px description (`:786`) rendered at *the same brightness*, with a 22px `›` (`:787`) at the
same brightness again. The title/subordinate hierarchy that exists on desktop (`#8b949e` under
`--pi-text`) is simply absent on touch devices — eight rows of flat, equally bright text, and the
chevrons read as content rather than as affordances.

Confidence: high.

## F2 The rename dialog's entire action bar is unstyled UA chrome

- `src/client/src/components/SessionRenameDialog.ts:35` — the only button rule in the component is `button { font: inherit; }`
- Markup it leaves bare: `:79` header `×`, `:89` `Cancel`, `:90` `<button class="primary" type="submit">Rename</button>`
- `.primary` has **no rule anywhere in the file** (class emitted at `:90`); there is no `button:disabled` rule although `:90` uses `?disabled=${!canSubmit}`
- `interactiveSurfaceStyles`, which this file imports (`:25`), only sets
  `-webkit-tap-highlight-color` and `touch-action` (`shared.ts:17-35`) — the app has no global button
  padding/appearance reset, so the UA defaults survive into the dialog.

Surface: rename-session dialog (session row → Rename, from the quick switcher or session list).

Minimal failure scenario: rename a session. Inside the dark `--pi-bg` panel (`ModalSurface.ts:174`)
Cancel and Rename render as platform-default light beveled buttons at ~21px height; Rename is
visually identical to Cancel; while the PUT is in flight the button greys through the UA rather than
the `opacity: .5; cursor: not-allowed` treatment every sibling dialog applies
(`ProjectDialog.ts:368`, `MachineDialog.ts:148`, `SessionTreeNavigator.ts:605`).
Proof this is drift and not a house style: the structurally identical footer in
`ProjectDialog.ts:364` is given `border: 1px solid var(--pi-border); border-radius: 8px;
background: var(--pi-surface); padding: 7px 9px`.

Confidence: high.

## F3 Same dialog: the field has no fill, an off-scale corner, and an un-muted label

- `src/client/src/components/SessionRenameDialog.ts:33` — `background: var(--pi-bg-raised)`, `border-radius: 6px`, and no `:focus` rule at all
- `--pi-bg-raised:` is undefined (`index.html:105-106` defines only `--pi-bg` and `--pi-surface`) → background computes to `transparent`, so the input shows the panel's own `--pi-bg` (`ModalSurface.ts:174`) and reads as a caption with a line under it, not as a field.
- Every peer field paints a deliberate inset fill: `ProjectDialog.ts:334`, `MachineDialog.ts:138`, `AuthDialog.ts:274`, `ModelPicker.ts:280`, `CommandPicker.ts:107` all use `background: var(--pi-bg)`; the shared list search uses `var(--pi-surface)` (`shared.ts:259`).
- Corner: 6px here vs 8px in all five of the above (and `var(--pi-radius-md)` in `shared.ts:259`).
- Label: `:32` sets `font-size: 13px` but no colour, so "Session name" renders full-bright; `ProjectDialog.ts:333`, `MachineDialog.ts:137`, `AuthDialog.ts:286` all set `label { color: var(--pi-muted) }`.

Minimal failure scenario: open the rename dialog, then the add-project dialog. Project's field is a
dark inset box, 8px corner, grey caption, blue border on focus. Rename's field is a 6px-cornered
outline on the panel colour with a bright caption whose only focus feedback is the browser's own
default ring. The form does not look typeable until you click it.

Confidence: high for the undefined token and all three divergences; medium-high for the
"doesn't read as editable" consequence.

## F4 Modal surfaces are not on one layer ladder — a picker can be painted under a dialog

- Pickers claim `--pi-layer-popover` (30): `ModelPicker.ts:271`, `CommandPicker.ts:98`, `SessionTreeNavigator.ts:525`
- Switchers/sheets claim `--pi-layer-overlay` (40): `QuickSwitcher.ts:392`, `appShell/ContextSwitcherSheet.ts:81`, `ActionPalette.ts:101`
- Dialogs claim `--pi-layer-dialog` (50): `SettingsDialog.ts:760`, `SessionRenameDialog.ts:26`, `SessionCleanupDialog.ts:209`
- Auth claims `--pi-layer-blocking` (60): `AuthDialog.ts:264`
- `src/client/src/components/modalLayerRegistry.ts` governs *modality and focus* only; its own comment states the host keeps its CSS z-index for painting, so paint order is decided by the five numbers above — not by which layer the registry considers topmost.

Surface: every picker/dialog pair.

Minimal failure scenario: open Settings (z 50). Trigger a picker while it is open — the documented
plugin seams `openThemePicker` / `openModelPicker` (`PiWebApp.ts:3172-3173`) or the global theme
command (`openThemeDialog()` at `:3377`, which calls `pushModalLayerFrame()` and renders a
`<command-picker>`). The picker mounts at the app root at z 30; the registry promotes it to the top
modal layer, so Escape and the focus trap go to it, while CSS paints it *behind* the settings panel.
What the user gets: the backdrop dims, no dialog appears, Escape seems to do nothing, and Settings is
now unclickable behind an invisible full-screen overlay.

Confidence: high on the declarations and the resulting inversion; the reachable path is
"picker opened while a dialog is open" (plugin seam + global shortcut).

## F5 The quick switcher re-implements the shared tile spec and drifts on every dimension

Canonical tile system: `shared.ts:303` (grid `minmax(150px,1fr)`, gap 8), `:312` (tile `min-height:
56px`, padding-right **derived** as
`calc(var(--pi-tile-menu-inset) + var(--pi-tile-menu-size) + var(--pi-space-2))`), `:313` (menu
inset `top/right: 6px`), `:324`/`:332` (toggle 32px, `--pi-tile-menu-size: 32px; --pi-tile-menu-inset:
6px`), `:339-340` (coarse: **36px**, inset 4px).

Quick switcher's private copy: `QuickSwitcher.ts:410` (grid `minmax(240px,1fr)`, gap 6), `:411`
(`min-height: 52px`, hardcoded `padding-right: 34px`), `:463` (toggle `top: 0; right: 0`), `:482`
(coarse **44px**).

- `shared.ts:308-311` is a comment recording the exact bug the derived value exists to prevent ("a hardcoded 30px while the button measured 32px … so a long name ran underneath the button on every phone. Derive it instead.") — the quick switcher hardcodes the same number again.
- `shared.ts:333-337` records a *deliberate* exemption capping the tile menu at 36px on touch; `QuickSwitcher.ts:482` ships 44px, and `SessionList.ts:769` ships 44px. The written exemption is followed only by components that consume `listStyles`, so the same ⋯ affordance renders at 32 / 36 / 44 px in three places on the same screen flow.

Minimal failure scenario: open the workspace list (tile ⋯ 36px inset 4px on a phone) and then the
quick switcher (⋯ 44px, flush into the tile's 12px corner, no inset). Same glyph, same verb, three
sizes.

Confidence: high.

## F6 The quick switcher's row-menu button has a base rule that can never render

- `QuickSwitcher.ts:455` — `.row-menu-toggle { flex: 0 0 auto; width: 40px; min-height: 52px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); … font-size: var(--pi-text-lg) }`
- `QuickSwitcher.ts:463` — same selector, **unconditional** (no media query around it): `position: absolute; top: 0; right: 0; width: 32px; min-height: 32px; border-color: transparent; background: transparent;`
- The comment at `:458-461` explains the second rule as the narrow-phone layout ("On a narrow phone the menu button's own column left the name about a hundred pixels…"), but there is no breakpoint; the only nearby query is `@media (max-width: 430px)` at `:468`, which touches `.rows` alone.

Surface: every session tile, at every viewport.

Consequence: the bordered 40×52 tile-peer button is dead code; what renders is a borderless 32×32
overlay. Anyone tuning "the desktop button" at `:455` changes nothing on screen, and the 44px coarse
override at `:482` is layered on a base geometry that no longer describes the element. `:463` also
clears only `border-color`, so the button keeps `:455`'s invisible 1px border — its content box sits
1px inset relative to the 44px coarse variant, so the ⋯ glyph shifts by ~1px between desktop and
phone.

Confidence: high (pure cascade arithmetic).

## F7 The tile reserves up to 86px of width for a 44px button; session names truncate to ~5 characters

- `QuickSwitcher.ts:411` — `.row { padding: var(--pi-space-5) 34px var(--pi-space-5) var(--pi-space-6) }` (34px right)
- `QuickSwitcher.ts:462` — `.row-title { padding-right: 30px }`, raised to **52px** on coarse at `:486`
- What those reserves are for: the toggle, 32px (`:463`) or 44px (`:482`)
- Column floor on a phone: `:468-470` `@media (max-width: 430px) { .rows { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)) } }` — and the comment at `:464-467` states the intent is to give the name more room.

Arithmetic, 140px tile, coarse pointer, border-box:
140 − 2 (borders) − 12 (left padding) − 34 (row padding-right) − 52 (title padding-right) ≈ **40px**
of glyph run ≈ 5 characters, before `-webkit-line-clamp: 2` (`:417`, `min-height: calc(2 * 1.3em)` at
`--pi-text-md` 15px) ellipsises — and that run is shared with the inline `⚑` pin marker and the word
"main" (`:209`, `:121`).

Minimal failure scenario: two sessions named `finish the wizard copy` and `finish the wizard tests`
on an iPhone. Both tiles show `finish t…` on both lines: the name is the only thing that
distinguishes a tile, and 86 of the tile's 140px are held for a button that needs 44. The shared
spec (`shared.ts:312`) reserves exactly `inset + size + 8`, returning ~40px to the name.

Confidence: high on the arithmetic; high that this is the visible truncation symptom.

## F8 The row menu opens ~39px away from its own trigger, and can open past the scroll fold

- Trigger: `QuickSwitcher.ts:463` — `position: absolute; top: 0; right: 0` (top-right of the tile)
- Menu: `QuickSwitcher.ts:471` — `.row-menu { position: absolute; top: calc(100% - 4px); right: 0; z-index: 3 }`, anchored to `.row-wrap`, i.e. the whole tile (`:451`)
- Tile height: `:411` `min-height: 52px`, but content forces ~75px — 10 + `calc(2 * 1.3em)` = 39 (`:417`) + 2 gap + 12 (`:418`) + 10 + 2px border
- Items: Open / Pin to top / Rename (`:232-234`), each `min-height: 40px` (`:472`) → the panel is ~140px tall
- Scroll container: `.body { overflow: auto }` (`:404`); the menu is `position: absolute` inside it and there is no `scrollIntoView` anywhere in the file

Minimal failure scenario A: tap ⋯ at the top of a tile. The menu's top edge lands at y≈71 from the
tile's top, while the 32px button ends at y=32 — ~39px of tile text between the control and the
thing it opened. On a coarse pointer the button (0–44px) is *adjacent* to the panel, so the gap only
looks intentional on a phone; on desktop it is visibly detached.
Scenario B: tap ⋯ on the last partially visible tile — ~140px of menu renders below the tile's
bottom edge, i.e. beyond the bottom of `.body`, so the menu appears to flash and vanish into the
fold with no scroll correction.

Confidence: high on geometry; medium-high on the fold case (depends on list length / scroll offset).

## F9 The row-menu `⋯` and the session-state badge are two sets of three dots in one 44px corner

- The quick switcher's row-menu glyph is a literal `⋯`: `QuickSwitcher.ts:216-222`
- The "working" state mark is *three dots*: `sessionStateBadgeStyles.ts:38-39` (`.state-dots` / `.state-dot`, three 4px dots, 2px gaps, `--pi-accent`, bouncing per `:40`), included into this component at `:391` and rendered at `:211`
- Both are pinned to the tile's right edge: `:423` `.row-flag, .row-state { position: absolute; top: 50%; right: 12px; transform: translateY(-50%) }`; the toggle occupies `right: 0` and on coarse pointers spans y 0–44 (`:463`, `:482`)

On the ~75px tile from F8 the badge's centre is y≈37.5 — inside the 44px coarse toggle box — and the
badge spans right−28…right−12 while the toggle spans right−44…right. The ⋯ glyph (17px
`--pi-text-lg`, `:455`) spans roughly y 13–31, so the two three-dot marks sit about 5px apart
vertically inside the same column.

Minimal failure scenario: a session is generating. Its tile shows `⋯` directly above an animated
`•••`, both blue, in the same corner, ~5px apart. The user cannot tell which one is the menu;
long-press (`:204` `longPress.start`) is the only unambiguous way in. In `SessionList.ts:421` the
same `⋯` never collides with anything, because the row layout puts the badge two hundred pixels away
— it is the tile collapse in the quick switcher that stacks them.

Confidence: high on the geometry; medium on the perceptual confound (the glyph-family collision —
"three dots = state" vs "three dots = menu" — holds regardless).

## F10 Four different geometries for the same search field

- Shared spec: `shared.ts:259` — `height: 34px; border-radius: var(--pi-radius-md)` (8px), `font: var(--pi-control-font-size, 14px)`; coarse 44px at `:268`
- `QuickSwitcher.ts:400` — `height: 40px; border-radius: var(--pi-radius-lg)` (12px), `font-size: var(--pi-text-lg)` (17px, the only search field whose type size bypasses the control token); coarse 44px at `:488`
- `ModelPicker.ts:280` and `CommandPicker.ts:107` and `AuthDialog.ts:274` — no height at all (~36px from `padding: 8px 10px`), literal `border-radius: 8px`
- `PromptHistoryPanel.ts:122` — `height: 44px; border-radius: var(--pi-radius-lg)`

Minimal failure scenario: open the session list (34px field, 8px corner) and then ⌘K's quick
switcher (40px field, 12px corner, 17px text). Two search boxes in the same keyboard flow, 6px apart
in height and 4px apart in corner radius; the quick switcher's is also the only one that will not
follow a `--pi-control-font-size` change.

Confidence: high.

## F11 The two most-used pickers delete the focus ring the rest of the family draws

- `ModelPicker.ts:280` `input.search { … outline: none }` + `:281` `input.search:focus { border-color: var(--pi-accent) }` — the only feedback is a 1px border recolour (#30363d → #58a6ff)
- `CommandPicker.ts:107-108` — identical; `AuthDialog.ts:274-275` does the same *but also* restores `input:focus-visible { outline: 2px … }` at `:271`
- Against the spec `shared.ts:262` (`.list-search-input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent) }`) and against `QuickSwitcher.ts:402`, `MachineDialog.ts:139`, `ExtensionDialogCard.ts:477`, `SessionTreeNavigator.ts:604` — all plain 2px rings
- Second instance in the same file: `ModelPicker.ts:277` `.options { outline: none }` with **no** `:focus-visible` rule, while its near-identical twins keep both halves — `CommandPicker.ts:101-104` and `AuthDialog.ts:267-270`. The option list is `tabindex="0"` in all three (it is the arrow-key target).

Minimal failure scenario: on a desktop browser, tab into the model picker. Focus lands in the search
field: no ring, just a border tint that is nearly invisible against the light-theme border; press Tab
again and focus moves into the option list where *nothing at all* is drawn — while the identical
key sequence in the command/theme picker draws a 2px blue ring around the list.

Confidence: high.

## F12 The confirm button has four unrelated recipes, and the token that would rescue its contrast does not exist

Fills for the same "commit" action:
1. `--pi-accent` fill — `ExtensionDialogCard.ts:478`, `AskUserCard.ts:627`, `SessionTreeNavigator.ts:606`
2. `--pi-success-border` (#238636) fill — `ProjectDialog.ts:367`, `MachineDialog.ts:147`
3. `--pi-success-surface` tint with green label — `AuthDialog.ts:289`
4. `--pi-selection-bg` tint with `--pi-text-bright` — `settings/SettingsGeneralPanel.ts:287`, `settings/SettingsShortcutsPanel.ts:354`
5. nothing — `SessionRenameDialog.ts:90` (see F2)

Text colour on variant 1 splits three ways over an identical fill:
- `color: var(--pi-accent-contrast, white)` — `AskUserCard.ts:627`, `ExtensionDialogCard.ts:478`, `SessionList.ts:697`. `--pi-accent-contrast` is **undefined repo-wide**, so it ships `white`: **2.5:1** on `--pi-accent #58a6ff` (`index.html:117`), below AA for the 13–14px 650-weight label it carries.
- `color: var(--pi-bg)` — `SessionTreeNavigator.ts:606`, same fill: **7.5:1**.
- Variants 2 declare no `color`, so they inherit `--pi-text #e6edf3` on `#238636`: **4.0:1**, also under AA.

Dead declarations in the shared recipe: `ExtensionDialogCard.ts:466` sets `button { border: 0 }`, so
the `.primary-action { border-color: var(--pi-accent) }` at `:478` can never paint; the identical
ruleset in `AskUserCard.ts:627` *does* paint, because that file keeps `border: 1px solid
var(--pi-border)` at `:616`. Two files, one copied rule, one no-op.

Minimal failure scenario: an extension asks for confirmation (blue block, white 2.5:1 label, no
outline) while the session-tree navigator offers the same affirmation (blue block, dark 7.5:1 label,
outlined). Same word, same fill, one of them is hard to read. Then change `--pi-accent`: the three
`white`-fallback buttons don't move, the `--pi-bg` one does — the fallback has quietly become the
design.

Confidence: high on divergence and the undefined token; contrast computed, ±0.1.

## F13 In a picker, "selected" means the keyboard cursor; the actual current value is prose

- `CommandPicker.ts:38-39` — `class=${index === this.selectedIndex ? "selected" : ""}` and `aria-current="true"` are driven by `selectedIndex`, the arrow-key cursor, which resets to the first filtered row on every keystroke (`:65-67`); `:110` tints that row with `--pi-selection-bg`.
- The committed value is carried as *text appended to the label*: `PiWebApp.ts:3366` `` `${id} ✓ current` `` (models), `:3500` (thinking levels), `:3482` `` `${theme.name} ✓ ${markers.join(" · ")}` `` (themes) — rendered verbatim into a plain `<span>` at 14px (`CommandPicker.ts:44`).
- The sibling picker does it the other way: `ModelPicker.ts:292` / `:295` mark the current value with the row tint.

Minimal failure scenario: open the model picker. The current model's row is tinted *and* says
`✓ current`. Press Down, or type two characters to filter: the tint — the app's only "this one"
affordance, and `aria-current` with it — jumps to the cursor, and the current model is now marked
only by a grey `✓ current` suffix glued to a 40-character provider/model id that has wrapped onto
its second line. Two different meanings were sharing one visual, and what survives is prose inside a
label rather than a mark (the app already has a badge vocabulary in `sessionStateBadgeStyles.ts` and
`activityBadge.ts` that no picker uses).

Confidence: high on the markup and cascade; medium-high on the legibility impact.

## F14 The 44px touch floor is enforced four incompatible ways — and not at all in the machine dialog

- The family policy is written down three times (`ModelPicker.ts:282-284`, `CommandPicker.ts:114-116`, `QuickSwitcher.ts:473-477`) and tokenised as `--pi-control-height-touch: 44px` (`index.html:81`): raise controls under `@media (pointer: coarse)`, declared after the base rules.
- `pi-web-plugins/machines/browser/MachineDialog.ts` — **zero** media queries (`grep -c "@media"` → 0). Footer buttons are `padding: 7px 9px` (`:145`) ≈ 33px tall; the close `×` is `font-size: 22px; padding: 0 8px` (`:146`) ≈ 22×30px.
- Its twin `ProjectDialog.ts` does raise them: `:366` (44×44 close) and `:362` (`footer button { min-height: 44px }`).
- But `ProjectDialog.ts:355` keys that footer floor to `@media (max-width: 760px)` rather than pointer type — so a tablet-class touch device at ≥768px CSS width (iPad portrait: 768/834/1024) keeps ~33px Cancel/Add buttons while the same file's close button correctly gets 44px via `pointer: coarse`.
- `AskUserCard.ts` inverts the policy twice: `.option { min-height: 44px }` is unconditional (`:552-561`, desktop included, justified by its own comment), while `.primary-action` gets 42px from a **container-width** query `@container (max-width: 580px)` (`:652`, `:663`) — so a phone held in a wide container gets 42px and a desktop window gets 44px option rows.
- `ExtensionDialogCard.ts:533-534` raises its action buttons to 44px on coarse, but `.dialog-input` (`:424-433`) never gets a floor: inside one phone dialog the buttons are 44px and the field you must tap to type is ~38px.

Minimal failure scenario: from the Settings sheet on a phone, add a machine — MachineDialog gives you
33px Cancel/Save and a 22×30 close `×`. Cancel straight into add-project — ProjectDialog gives you
44px buttons and a 44×44 close. The two forms are three lines apart in the same flow.

Confidence: high.

## F15 The machine row menu is a third smaller than every other row menu in the app

- `pi-web-plugins/machines/browser/MachineSwitcher.ts:330-331` — trigger `26×26`, `top/right: 4px`; `:334` menu items `padding: 7px 9px` ≈ 28px tall
- The file's only media queries are `@media (hover: hover)` (`:298, 315, 337, 339, 341`) — no `pointer: coarse` rule exists anywhere in it
- `:333` hand-copies the popover panel instead of composing the shared `.action-menu-panel` (`shared.ts:424`) — and the shared one is what carries the touch floor `.action-menu-panel button { min-height: 44px }` (`shared.ts:270`). The copy also drifts: shared padding `var(--pi-space-2)` and `--pi-surface` vs `var(--pi-space-3)` and `--pi-surface-raised` here.
- Every other row menu: `QuickSwitcher.ts:472` → `:487` (40px → 44px), `QuickSwitcher.ts:482` (trigger 44px), `SessionList.ts:769` (trigger 44px), `shared.ts:339-340` (tile trigger 36px)

Minimal failure scenario: switch machine on a phone, open the machine list, tap the ⋯ in a tile
corner: a 26px target with ~28px Edit / Open terminal / Remove rows, against 44px for both in the
session switcher one screen away — an 18px-per-side difference in the hit area for the same verb.

Confidence: high.

## F16 Off-scale corner radii, including a dialog shell drawn at two different corners

Token scale and the nesting rule: `index.html:51-59` — xs4 / sm6 / md8 / lg12 / xl16 / pill999, with
the documented corner-sliver requirement at `index.html:55-57` (inner + 5.66px ≤ outer).

- `SettingsDialog.ts:761` sets `--modal-surface-radius: 14px` and `SessionCleanupDialog.ts:210` sets `14px`, against `ModalSurface.ts:174`'s default of `12px`. The same shell component therefore has two different corners depending on who opens it — and 14px is on no step of the scale.
- `settings/SettingsPanelFrame.ts:107` notice card `border-radius: 10px`; `:114` inline `code { border-radius: 5px }`. Neither value exists on the scale; the `code` chips (5px) sit inside the notice (10px) inside a panel inside the shell (12 or 14px) — four curvatures in one stack.
- `SessionRenameDialog.ts:33` 6px inside a 12px shell where every peer field uses 8px (F3).
- Literal counts across the client (excluding the token definitions themselves): 8px×44, 10px×16, 999px×13, 6px×12, 7px×10, 5px×9, 4px×3, 2px×3, 12px×2, 3px×1, 14px×1 — the off-scale values (5, 7, 10, 14) are used more often than `var(--pi-radius-lg)` is referenced.
- `designTokens.test.ts` asserts that tokens are *defined*; nothing asserts that every `var(--pi-radius-*)` / `var(--pi-text-*)` **use** resolves — which is how F1, F3 and F12 survived.

Minimal failure scenario: Settings → Appearance: 5px code chips inside a 10px notice inside a 12px
panel inside a 14px shell; Settings → session cleanup is a 12px shell. Change `--pi-radius-lg` and
roughly half the app's corners stay where they were.

Confidence: high on the numbers; medium that the 14px pair is drift rather than a deliberate
per-dialog choice (no comment records a decision, and the two users are unrelated components).

## F17 The close control — the most-touched control in this family — has three glyph sizes and four box sizes

- 24px glyph in an explicit 44×44 box: `SettingsDialog.ts:766`
- 22px glyph, no box: `ProjectDialog.ts:365` (`padding: 0 8px` → ≈30×22; raised to 44×44 only on coarse at `:366`); `MachineDialog.ts:146` (22px, never raised — see F14)
- 20px glyph: `ModelPicker.ts:279`, `CommandPicker.ts:106`, `QuickSwitcher.ts:403` (`var(--pi-text-xl)`, `padding: 0 8px` → ≈30×23 desktop, 44×44 coarse at `:479`), `appShell/ContextSwitcherSheet.ts:85` (44×44 always)
- In `ModelPicker.ts:279` / `CommandPicker.ts:106` no width/height/padding is declared at all, so the target is the glyph plus the UA's default `1px 6px` button padding — ≈21×23 on desktop, before the coarse override (`ModelPicker.ts:286`, `CommandPicker.ts:118`)
- 14px `‹` for the paired back affordance in the same dialog whose forward chevron is 22px: `SettingsDialog.ts:787` vs `:789` (`.settings-back`, `font-size: 14px`)

Header and title scales drift with them: header padding is 10px (`QuickSwitcher.ts:399`,
`--pi-space-5`), 12px (`ModelPicker.ts:273`, `CommandPicker.ts:100`, `SessionRenameDialog.ts:29`,
`ProjectDialog.ts:330`, `MachineDialog.ts:134`), 14px/16px (`SettingsDialog.ts:762`), 8px
(`ContextSwitcherSheet.ts:82`). Titles are `<strong>` at the 14px host font in the pickers
(`ModelPicker.ts:89`, `CommandPicker.ts:31`) and absent altogether in the quick switcher, whose
header is search-field-plus-`×` only (`:102-103`) — versus `h1 { font-size: 20px }`, a literal rather
than `var(--pi-text-xl)`, in Settings (`:764`).

Minimal failure scenario: within one minute a user dismisses the add-project dialog (≈30×22 target,
22px glyph), the Settings dialog (44×44, 24px glyph) and the model picker (~21×23, 20px glyph) — three
renderings of the same `×`, none of them meeting 44px on desktop, one of them not meeting it on a
phone either (MachineDialog).

Confidence: high on the numbers; medium that the spread is drift rather than intent (no comment
anywhere states a close-control spec).

## F18 Sibling dialogs put the Cancel / confirm pair in different places

- `SessionRenameDialog.ts:29-30` — the footer inherits `justify-content: space-between` (the `footer` override at `:30` changes only the borders) and has exactly two children (`:89`, `:90`) → Cancel is pinned hard left, Rename hard right.
- `ProjectDialog.ts:331` and `MachineDialog.ts:135` — identical markup, `justify-content: end` → the pair sits together at the right.
- `AuthDialog.ts:287` — `.actions { justify-content: flex-end }`.

Minimal failure scenario: rename a session (confirm at the far edge of a 560px panel), then add a
project (confirm immediately inside the right edge). The motor plan for "the second button" lands on
empty space in one of the two, and the far-left Cancel in the rename dialog sits directly under the
field's left edge — where the eye returns after typing.

Confidence: high on the declarations; medium on the interaction cost.

TOTAL: 18 findings.
