# Desktop and phone: every difference, and whether it is meant

This is the enumeration the parity goal asked for. Each row says where the
difference lives, what changes, and whether it is deliberate adaptation or a
defect. It was produced by reading the client sources; anything that could not
be settled by reading is marked *not established* rather than guessed.

## How the sizes are decided

| threshold | mechanism | where |
| --- | --- | --- |
| 1181px / 1180px | CSS + `matchMedia` | `PiWebApp.ts:153,167,265` |
| 760px | CSS, plus `MOBILE_NAVIGATION_MEDIA_QUERY` | `appShell/appShellController.ts:6` |
| 680px | CSS | `SessionCleanupDialog.ts:248` |
| 640px | CSS | `ChatView.ts:147`, `AppContextBar.ts:495`, `WorkspaceFileViewer.ts:331` |
| 620px (height) | CSS | `PromptEditor.ts:104`, `ChatView.ts:307` |
| 520px | CSS | `ChatView.ts:300` |
| 430px | CSS | `PromptEditor.ts:187`, `AppContextBar.ts:432` |
| 420px | CSS | `QuickSwitcher.ts:426` |
| pointer / hover | CSS + `matchMedia` | throughout |

Container queries (430px, 580px, 140px) key off panel width, not the viewport,
and are listed separately below.

## Deliberate

- Shell reflow at 1181 / 1180 / 760: three panes, two panes, one column.
- Navigation panel compact mode at 760, with the context bar taking over.
- Every settings panel collapsing to one column at 760. Uniform across ten panels.
- Touch targets growing on coarse pointers, and in the composer at 430.
- Drawer and composer caps at `max-height: 620px`, for a phone with the keyboard up.
- Hover affordances behind `(hover: hover)`, enforced by `hoverGuard.test.ts`.
- Terminal soft keys and copy mode only where there is no physical keyboard.
- Full-bleed modals on small screens.
- No initial input focus on touch, so the keyboard does not open uninvited.

## Defects

### D1. Between 761px and 1180px there is no way to switch workspace tools

`shared.ts:181` hides the workspace panel `<header>` at `max-width: 1180px`, and
the tab strip lives inside it (`WorkspacePanel.ts:55-72`). Its replacement, the
"Go to a view" sheet, is reached from the context bar, which renders only when
`isMobileNavigationLayout || navigationCollapsed` (`whereAmIBar.ts:12`, fed by
the 760px query).

So in a 421px-wide band, with the navigation panel expanded, neither exists. The
tabs are rendered and merely invisible - `hideToolTabs` (`WorkspacePanel.ts:22`)
is never set by any caller - so this is a display rule, not a missing feature.

Only two of the panels have another route: the action palette entries
`core:workspace.files` and `core:workspace.terminal` (`plugins/core/actions.ts:110,120`).
Plugin panels have none.

**This is the one difference where a control exists at no size in a range.**

### D2. Panel edge controls disappear at two different sizes

Workspace edge control: gone at 1180 (`AppPanelEdgeControl.ts:226-229`).
Navigation edge control: gone at 760 (`AppPanelEdgeControl.ts:230-232`).

Same component, same role, 420px apart. Nothing explains the difference.

### D3. The touch-target floor moves in both directions at one width

At 430px the composer icon buttons grow to 40px (`PromptEditor.ts:191`) while
the context bar action buttons shrink to 32px (`AppContextBar.ts:434`) - opposite
directions at the same breakpoint. 32px is below the 36px the session list uses
at 760 (`SessionList.ts:747-749`) and the 40-44px used on coarse pointers
throughout `ChatView.ts`.

### D4. Four narrow-phone rules, three numbers, two query types

`QuickSwitcher.ts:426` is the only 420px in the tree. The composer and context
bar use 430px; the workspace tab strip uses a 430px *container* query. Nothing
distinguishes these cases.

### D5. Two modals choose full-bleed at different widths

`SettingsDialog.ts:662` at 760px, `SessionCleanupDialog.ts:248` at 680px, both
applying the same override.

### D6. The 760px line is written three times in three mechanisms

CSS literals, the `MOBILE_NAVIGATION_MEDIA_QUERY` constant, and the compound
`"(pointer: coarse), (max-width: 760px)"` in `promptEnterBehavior.ts:1` and
`terminalSoftKeysPreference.ts:2` - the last duplicated as CSS at
`TerminalPanel.ts:694`. Nothing links the copies to the constant.

### D7. Dead responsive CSS in the shell

`PiWebApp.ts:132-139` and `:185` style a `.context-bar` element that the
template never renders; the real bar is `<app-context-bar>` with its own shadow
styles. The shell's copy cannot match anything.

**Not established:** whether inline markup for it once existed.

## Information present at one size and not the other

These remove information rather than controls. Each is defensible; they are
listed so the choice is visible rather than discovered.

| what | present | absent | where |
| --- | --- | --- | --- |
| session tree row timestamps | >760px | ≤760px | `SessionTreeNavigator.ts:620` |
| list section heading labels | >760px | ≤760px | `shared.ts:271-273` |
| action palette shortcut hints | fine pointer | coarse pointer | `ActionPalette.ts:127` |
| workspace tab labels | panel >430px | panel ≤430px | `shared.ts:172-175` |
| context switcher step names | panel >140px | panel ≤140px | `AppContextSwitcher.ts:106` |
| message metadata | hover reveals text | tap a 26px glyph | `ChatView.ts:528,531-538` |

## Reversed direction: present on phone, absent on desktop

- Terminal copy-mode toggle, soft-keys toggle and the soft-key row appear only
  on a coarse pointer or ≤760px (`TerminalPanel.ts:694-697`). A fine-pointer
  desktop cannot reach them at all, although the preference behind them is
  persisted and toggleable in principle.
- Chat and composer are hidden whenever a workspace tool is open at ≤1180px
  (`PiWebApp.ts:177-179`), so sending a prompt while looking at a file is a
  desktop-only ability.
