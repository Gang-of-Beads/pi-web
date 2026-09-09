# Round 14 — Lane B: dialogs / pickers / sheets (geometry, rhythm, marks, scale)

Scope swept this round (all file:line verified against working tree):
QuickSwitcher.ts, ModelPicker.ts, CommandPicker.ts, ModalSurface.ts, SessionRenameDialog.ts,
SessionCleanupDialog.ts, AuthDialog.ts, ExtensionDialogCard.ts, AskUserCard.ts, SettingsDialog.ts,
settings/settingsControlStyles.ts, settings/SettingsPanelFrame.ts, settings/SettingsGeneralPanel.ts,
settings/SettingsAppearancePanel.ts, settings/SettingsMachinesPanel.ts, settings/SettingsSessiondPanel.ts,
settings/SettingsPackagesPanel.ts, settings/SettingsPluginsPanel.ts, settings/SettingsShortcutsPanel.ts,
settings/SettingsFleetSection.ts, FormattedText.ts, shared.ts (control rules), uiIcons.ts,
pi-web-plugins/machines/browser/{MachineDialog,MachineSwitcher,MachineList}.ts,
pi-web-plugins/workspaces/browser/{ProjectDialog,ProjectList,WorkspaceList,hostUi}.ts.

---

## F1 — QuickSwitcher rename actions: typed ✓/× glyphs, typographically (not geometrically) centred; inconsistent with the same component's own close button  [severity: high]

- `src/client/src/components/QuickSwitcher.ts:249` — confirm button content is the typed character `"\u2713"` (✓)
- `src/client/src/components/QuickSwitcher.ts:250` — cancel button content is the typed character `"\u00d7"` (×)
- `src/client/src/components/QuickSwitcher.ts:508` — `.rename-actions button { … font: inherit; … }`: no
  `display: grid; place-items: center`, no `line-height: 1`, no `font-size`, and no `svg` sizing rule
  (confirming SVG was never intended here).

**Why it breaks the lane's contract:**

1. *Geometric centring (audit category 1).* Buttons centre their inline line box, not the glyph's ink.
   × (U+00D7) ink sits at math-axis height above the baseline; ✓ (U+2713) sits on the baseline with
   descender overhang. In two adjacent 36px square buttons (`width/min-height:
   var(--pi-control-height-comfort)`), the two marks therefore sit at visibly different heights from
   each other and off the box centre. Every other icon-bearing control in this codebase pins this
   down explicitly — including **QuickSwitcher's own close button** at
   `QuickSwitcher.ts:403` (`display: grid; place-items: center; line-height: 1;`),
   MachineDialog.ts:146, AuthDialog.ts:273, SessionRenameDialog/SessionCleanupDialog/SettingsDialog
   `.close-button`, all the same grid+place-items+line-height:1 pattern.
2. *Scale escape.* The house × is drawn at `font-size: var(--pi-text-xl)` (QuickSwitcher.ts:403,
   SettingsDialog close, MachineDialog close). Here both glyphs render at `font: inherit` (~14px):
   a smaller × lives ten lines away from the xl × in the same shadow root.
3. *Mark discipline (audit category 5).* `src/client/src/components/uiIcons.ts:6` states the project's
   charter verbatim: "These were typed characters - ⧉ ↻ ↩ ✓ ✖ ▶ ↑ ↓ - so each took whatever font
   resolved it" — and exports `renderCheckIcon()` / `renderCrossIcon()` for exactly this. Those
   functions are used for success/copy marks (ChatView.ts:506-508, 1870; ToolExecutionView.ts:242-243)
   but QuickSwitcher never imports uiIcons (import list at `QuickSwitcher.ts:1-17` has no uiIcons), so
   the one inline-form confirm action in this sheet is still a typed tick.
   (The header × close is the accepted house convention; **these are action buttons inside an inline
   form**, a different role — they were not part of that convention's rounds.)

**Fix:** render `renderCheckIcon()` / `renderCrossIcon()` in the two buttons (svg inherits
`currentColor`), and add to `.rename-actions button` (line 508) the house icon-button trio
`display: grid; place-items: center; line-height: 1;` — or the uiIcons `uiIconStyle` vertical-align
pattern if kept inline.

## F2 — QuickSwitcher machine tabs: `border-bottom: 0` tab idiom with no shared baseline to merge into  [severity: medium]

- `src/client/src/components/QuickSwitcher.ts:443` — `.machine-tab { … border: 1px solid var(--pi-border);
  border-bottom: 0; border-radius: var(--pi-radius-md) var(--pi-radius-md) 0 0; … }`
- `src/client/src/components/QuickSwitcher.ts:441` — `.machine-tabs { … padding: var(--pi-space-3) var(--pi-space-5) 0; }`
  (zero bottom padding, no border on the strip itself)
- `src/client/src/components/QuickSwitcher.ts:445` — the immediately following row, `.filters`, has
  `border-bottom` only — **no `border-top`**
- Render order confirms adjacency: `QuickSwitcher.ts:105-106` (`renderMachineTabs()` then `renderFilters()`,
  nothing between them).

**Why it breaks:** the "open-bottom, top-rounded" shape is the connected-tab idiom: it promises the tab
merges into a panel line below it. Here there is no line to merge with. Unselected tabs' left/right
hairlines terminate in mid-air at a bottom corner radius that leads nowhere; the selected tab's
`--pi-selection-bg` tint (line 444) bleeds across the strip/filter boundary with no divider, so
selection reads as a smear rather than a connected tab. The sheet's own vocabulary elsewhere is
ghost-chips (`.chip`, line 449, with the explicit comment "Chips ghost by default … a row of outlined
pills read as a wall of boxes") — the machine tabs are the only outlined, tab-shaped control in the
sheet.

**Fix:** either complete the idiom (give `.filters` a `border-top: 1px solid var(--pi-border)` that the
selected tab interrupts) or drop the tab shape and follow the sheet's ghost-chip language
(`.chip.on`-style tint, all-round radius).

## F3 — The copy affordance still exists in two languages: typed `⧉`/`✓` in code blocks and in the workspace detail menu, drawn SVG next to them in the same UI  [severity: high]

Three call sites of the *same verb*, rendered two different ways:

- Typed: `src/client/src/components/FormattedText.ts:81` (`icon.textContent = "⧉"`) and
  `FormattedText.ts:107` (`state === "copied" ? "✓" : "⧉"`) on the button styled by
  `src/client/src/components/shared.ts:473` (`.code-copy-button`, 24×24px, `font: var(--pi-text-base)
  var(--pi-font-ui)`, `line-height: 1`)
- Typed: `pi-web-plugins/workspaces/browser/WorkspaceList.ts:346`
  (`${copied ? "✓" : "⧉"}`) on `.action-menu-panel .detail-copy`
  (`src/client/src/components/shared.ts:391`, an **18×18px** box with the glyph at `--pi-text-2xs`)
- Drawn: `src/client/src/components/ChatView.ts:1870` — `renderCheckIcon() : renderCopyIcon()` for the
  message-level copy button.

**Why it breaks:** `uiIcons.ts:6` lists ⧉ and ✓ by name as the characters this module exists to retire,
and `renderCopyIcon()` exists and is already adopted by the sibling control. U+29C9 is absent from most
UI fonts, so `⧉` renders through a per-platform font lottery (tofu box on many systems) while the
message-copy button beside/above it always renders the crisp 14px SVG — one transcript, one verb, two
marks. The ✓ "copied" confirmation is also the one state-transition that round 12 standardized on
`renderCheckIcon()` (ChatView.ts:506-508, 1963; ToolExecutionView.ts:242). Ancillary, same controls:
neither copy target carries the coarse-pointer floor (24px / 18px) while the app-wide policy these
very files recite ("A control a person taps is a touch target wherever the card is shown",
ExtensionDialogCard.ts:526-527; MachineSwitcher's coarse block) raises tappable controls to 44px.

**Fix:** render `renderCopyIcon()` / `renderCheckIcon()` into these buttons (FormattedText builds the
button via DOM API — set `innerHTML` from the icon template or convert to the Lit pattern); add the
`@media (pointer: coarse)` floor to `.code-copy-button` and `.detail-copy` in shared.ts (one place,
both hosts inherit).

## F4 — AuthDialog provider status: bare typed `✓` prose carries the configuration state  [severity: medium]

- `src/client/src/components/AuthDialog.ts:372-377` — `statusLabel()` returns
  `"✓ configured"`, `"✓ env: …"`, `"✓ runtime"`, `"✓ custom key"`, `"✓ models.json key"`,
  `"✓ models.json command"`
- rendered inline in the option title at `AuthDialog.ts:69` (`html\` <em>${statusLabel(provider)}</em>\``),
  styled at `AuthDialog.ts:299` (`em { color: var(--pi-success); font-size: var(--pi-text-xs); }`)

**Why it breaks:** this is state carried by a typed character, not the drawn-mark vocabulary the rest
of the surface uses for exactly this ("present/ok" is a dot or a drawn check: `.header-status::before`
dot in ExtensionDialogCard.ts:376 and AskUserCard.ts:512, `.machine-status::before` dot in
MachineSwitcher, `renderCheckIcon()` in ChatView/ToolExecutionView). It is distinct from the excluded
"✓ current" picker prose: those are current-value suffixes on option labels; this is a *status badge in
a dialog row*. (Flagging the overlap risk with the exclusion honestly: if the reviewer rules the whole
"✓ + word" family excluded, this item drops — but the dialog context and the badge-like rendering put
it on the mark side of the line.)

**Fix:** `renderCheckIcon()` (or the dot pseudo-element) followed by the plain word; size via the icon
module rather than the ambient 12px `em` font.

## F5 — QuickSwitcher pinned-session mark escapes the drawn-icon standard (size + baseline)  [severity: low]

- `src/client/src/components/QuickSwitcher.ts:210` — pin SVG hand-inlined in the template (the file has
  no `uiIcons` import at all)
- `src/client/src/components/QuickSwitcher.ts:497` — `.pin-mark svg { width: 12px; height: 12px;
  vertical-align: -0.1em; }` vs the house values in `uiIcons.ts` (`uiIconStyle`: 14px,
  `vertical-align: -0.15em`, stroke-width 2, currentColor)

**Why it breaks:** the pin is the only drawn mark in the app at 12px on a `-0.1em` baseline; beside a
session title it sits ~0.6px higher optically than every other inline mark and reads smaller than the
dot scale next to it. It also bypasses the module whose entire purpose is "drawn in one place so size
is a decision". A `renderPinIcon()` addition to uiIcons (14px/-0.15em, or an explicitly reviewed 12px)
removes the divergence.

## F6 — Hygiene on the touch-size contract in ExtensionDialogCard (invisible today, a trap tomorrow)  [severity: low]

- `src/client/src/components/ExtensionDialogCard.ts:539-541` — an **empty** `@media (pointer: coarse) { }`
  block remains, preceded by a comment (lines 534-538) that points into it and references "the 42px
  desktop rule" held by "the container query" — no 42px rule exists in the file any more (the floor is
  now the unconditional `--pi-control-height-touch` at line 528).
- `src/client/src/components/ExtensionDialogCard.ts:482` — `.primary-action { border-color: var(--pi-accent); }`
  is dead: this card's base button is ghosted (`border: 0`, visible in the same style block's `button`
  rule); the declaration is a copy of the AskUserCard pattern where `button` does have
  `border: 1px solid var(--pi-border)` (AskUserCard.ts:624-625, 635).

No pixel moves today; both misrepresent the live contract to the next touch/border edit.

---

## Checked and clean (this round's candidates that survived scrutiny)

- **settingsControlStyles.ts** — the shared sheet owns control heights and the coarse-pointer floor
  (`min-height: control-height`, `@media (pointer: coarse) → control-height-touch`), and all nine
  settings panels adopt it (verified per file: 2 references each). Panel-local px hits are viewport
  breakpoints only.
- **ModelPicker / CommandPicker / ModalSurface / SessionRenameDialog** — every literal px is a
  fallback (`var(--pi-control-height-touch, 44px)`), a viewport constraint
  (`min(720px, calc(100vw - 40px))`) or a 1px border compensation. No scale escapes.
- **MachineDialog / MachineSwitcher / MachineList (plugins)** — heights tokenized; the coarse floor is
  pointer-scoped, not width-scoped, with the lesson comment quoted in-file (MachineDialog.ts:149-155);
  `⋯` row-menu trigger is the house-wide convention (QuickSwitcher.ts:221, SessionList.ts:426,
  ProjectList.ts:122, WorkspaceList.ts:235, MachineSwitcher.ts:123, MachineList.ts:170 — consistent).
- **QuickSwitcher footer/rename geometry** — `.rename-input` (36) and `.rename-actions button` (36)
  match heights and both raise to 44 on coarse (lines 505-506, 509); footer's unconditional 44px floor
  is owned by an explicit comment (touch-sheet by design).
- **ExtensionDialogCard / AskUserCard** — headers, ghost buttons, accent-fill primary with
  `--pi-on-accent`, dot pseudo-elements for status, 44px floors with owned comments; aside from F6.
- **SettingsAppearancePanel** — `.preview` height/radius verified round 9; the
  `gap: space-2 + margin-bottom: space-3` (10px preview→name vs 4px name→scheme) reads as deliberate
  grouping inside a card and is left alone.
- **MachineSwitcher `.machine-switcher-button`** — no explicit min-height, but the two-line content
  (kicker 2xs/1 + label xs/1.2 + padding) measures ≈37px and the sheet hides this control on phones
  where the context bar names the machine (`:host([hidden])` comment); not flagged.

## Explicit exclusions applied (evidence gathered, not just assumed)

- `"✓ current"` prose on picker option labels — ModelPicker.ts:175, PiWebApp.ts:3383/3499/3517,
  `"✓ on"` at PiWebApp.ts:3407: the known-deliberate "current value" prose family.
- Header-close `×` typed glyph — QuickSwitcher.ts:103/403, SessionRenameDialog, SessionCleanupDialog,
  AuthDialog:273, MachineDialog:146, SettingsDialog close: house convention, consistently
  grid-centred at `--pi-text-xl`, survived 13 rounds.
- `⋯` row-menu triggers — consistent across 7 call sites (see above).
- `⋮`/`▾` disclosure chevrons in plugin lists render through `renderHostDisclosureIcon` /
  disclosureIcon.ts (host-owned), the residual typed `▸/▾` in git-panel.ts:1019/1081 belongs to the
  git surface (other lane).
