# ROUND EIGHT - Lane A: app shell and chrome geometry after the scale work

Branch refactor/plugin-architecture @ cf5f0ce1. Verified by reading source only; contrast figures are computed from the token values in src/client/index.html (--pi-dim #6e7681, --pi-muted #8b949e, --pi-surface #161b22, --pi-bg #0d1117), not from a live browser.

TOTAL: 8 findings

## F1 The shared list search still dims its placeholder; the session list copy does not - same control, two colours, one below AA
- file:line: src/client/src/components/shared.ts:262 ('.list-search-input::placeholder { color: var(--pi-dim); }') vs src/client/src/components/SessionList.ts:766 ('.session-search-input::placeholder { color: var(--pi-muted); }'); shared.ts:258 comment: "Search affordance shared by the lists that have one, so a second list does not drift from the first."
- surface: context-sheet (machine/project/workspace searches via MachineList/ProjectList/WorkspaceList), sessions
- finding: the session search input and the shared list search input are the same control (comfort/touch height, same clear button) but their hint text disagrees: --pi-muted (6.15:1 on bg, 5.62:1 on surface) vs --pi-dim (3.77:1 on the input's --pi-surface fill, computed) - below the 4.5:1 AA floor for 13px hint text on a filled control.
- minimal failure scenario: on a phone open the context sheet with several workspaces, tap a list long enough to summon "Search workspaces" - its placeholder is visibly darker than the "Search sessions" field one panel above, and fails AA on its surface fill.
- confidence: high (both rules verified; the round-seven fix moved informational text off --pi-dim but only reached the session-list copy)

## F2 The orphan marker now outshines the normal child marker it is documented to be a dimmed copy of
- file:line: src/client/src/components/shared.ts:395 ('.tree-marker { color: var(--pi-dim); ... }'), src/client/src/components/SessionList.ts:718-719 (comment "Same glyph as a normal child marker, dimmed" + '.orphan-marker { color: var(--pi-muted); }')
- surface: sessions
- finding: two sibling leading marks in one list: the ordinary child-marker arrow renders --pi-dim at 3.77:1 on the row's --pi-surface (below AA for a meaningful text-size mark), while the orphan arrow - documented as the dimmed variant - renders --pi-muted at 5.62:1. The "dimmed" state is the brighter one; the hierarchy the comment states is inverted on screen.
- minimal failure scenario: a tree with one normal child and one orphan row: the orphan's marker pops while the regular child's marker sinks toward the surface - the row whose parent is present reads as the de-emphasised one.
- confidence: high on the values and the contradiction; note the round-seven orphan fix itself was correct (it left 2.3:1), but it promoted the orphan above its sibling instead of lifting the family floor

## F3 Quick switcher close control is 32px on a mouse where the dialog-close family (including the context sheet) is 36px, and it shares its row with a 36px search field
- file:line: src/client/src/components/QuickSwitcher.ts:403 ('.close { ... width: var(--pi-control-height); height: var(--pi-control-height); ... }') vs src/client/src/components/SettingsDialog.ts:766, src/client/src/components/SessionCleanupDialog.ts:244, src/client/src/components/SessionTreeNavigator.ts:537, src/client/src/components/appShell/ContextSwitcherSheet.ts:85 (all --pi-control-height-comfort); siblings in one grid row: QuickSwitcher.ts:399 (header, align-items center) and :400 (input at comfort height)
- surface: quick-switcher (adjacent to this lane's context-sheet; reported because the family agreement is what my surface conforms to)
- finding: the mouse-step close control split the family documented as "two-step sizing" (comfort on mouse, touch on coarse): 32 vs 36, a 4px sibling height split inside one header row where the search box is 36 and the close beside it is 32.
- minimal failure scenario: open the quick switcher on a mouse: the close is 4px shorter than the search field it is vertically centred with, and 4px shorter than the close in every other dialog.
- confidence: high on the values; the round-four "dialog close controls agree on a mouse size" claim no longer holds for this surface

## F4 The context sheet's header scrolls away with its lists; the chat drawer pins the same chrome on the same pointer class
- file:line: src/client/src/components/appShell/ContextSwitcherSheet.ts:82 ('.sheet { ... max-height: 100%; ... overflow-y: auto; }'), :83 ('.sheet-header { display: flex; ... }' - no sticky) vs src/client/src/components/ChatView.ts:131 ('.top-drawer:not(.collapsed) .drawer-header { position: sticky; top: 0; ... }' under the same max-width:640px rule at :128)
- surface: context-sheet (vs chat-drawer)
- finding: the sheet is one scroll container containing its own title and close button; with machines + projects + workspaces stacked (each list flex: 0 0 auto per ContextSwitcherSheet.ts:94), content overruns the viewport and the close travels with the scroll. The chat drawer solved the identical geometry by pinning its header on phones.
- minimal failure scenario: 393x850 phone, three lists with a handful of rows: open "Change context", scroll to the workspaces - the title and the only in-sheet close control are above the fold; the remaining exits are a backdrop tap or system back, neither of which is the control the surface drew.
- confidence: high on the geometry (no sticky rule exists in the file); medium on severity since a backdrop tap still closes

## F5 The phone panel header mixes two corner languages in one row
- file:line: src/client/src/components/appShell/AppNavigationPanel.ts:181-182 (refresh control, gear and Actions rendered as one compact-header row), :465 ('.compact-header-action { ... border-radius: var(--pi-radius-pill); ... }') vs src/client/src/components/appShell/AppRefreshControl.ts:40 ('.app-refresh-button { ... border-radius: var(--pi-radius-md); ... }')
- surface: sessions (phone shell chrome)
- finding: in the compact header the gear and Actions buttons are full pills while the refresh control sitting between them is an 8px-radius square; both are 44px-tall bordered --pi-surface controls, so the row reads as two shape families at equal weight.
- minimal failure scenario: 393x850 phone: pill, square, pill, pill - the refresh button's corners disagree with the two buttons it is flush against at the same size.
- confidence: medium (a deliberate phone-pill language is conceivable, but the refresh control is the odd one out inside that language)

## F6 Stacked chrome rows do not share a leading text inset - three left edges on one phone screen
- file:line: src/client/src/components/appShell/AppContextBar.ts:73 ('.context-bar { ... padding: 0 var(--pi-space-3); }') + :79 ('.session-title { ... padding: var(--pi-space-2) var(--pi-space-2); }' -> text at 10px); src/client/src/components/appShell/AppNavigationPanel.ts:464 ('.compact-header { ... padding: 0 var(--pi-space-4); }') + :482 ('.compact-scope { ... padding: 0; ... }' -> text at 8px); src/client/src/components/ChatView.ts:134 ('.drawer-header { ... padding: 0 var(--pi-chat-gutter); }') and :203 ('.chat { ... padding: var(--pi-space-9) var(--pi-chat-gutter) var(--pi-space-7); }' -> 6px on phones per index.html:190 '--pi-chat-gutter: 6px'); desktop rail: AppNavigationPanel.ts:457 ('header { ... padding: 0 var(--pi-space-6); }' -> 12px) above sections at shared.ts:275 ('section { ... padding: var(--pi-space-5); }' -> 10px)
- surface: sessions; chat; chat-drawer
- finding: the resident bar's session name starts 10px from the screen edge, the compact header's scope name 8px, and the drawer header / conversation 6px (phone) - three stacked 44-45px chrome bars, three leading edges. On the desktop rail the header text is inset 12px over lists inset 10px.
- minimal failure scenario: 393x850 phone with the panel open: "Sessions" (10px), the scope name (8px) and the chat's first message (6px) sit on three different left edges within 100px of vertical space; nothing on screen explains the steps.
- confidence: high on every measured value; medium that each pair is not an intentional layered offset

## F7 Panel edge control is a 48px-tall control - above the published control scale and invisible to the guard
- file:line: src/client/src/components/appShell/AppPanelEdgeControl.ts:212 ('.edge-button { ... width: 18px; height: 48px; ... }'); guard band: src/client/src/components/controlHeightScale.test.ts:17 (CONTROL_RANGE matches only 28-44px)
- surface: shell chrome between sessions panel / chat / workspace panel
- finding: every control height in the app reads --pi-control-height (32) / -comfort (36) / -touch (44); the collapse/expand edge button declares a bare 48px - a fourth height the scale does not name, and one the guard cannot see because its band ends at 44. The comment block above it documents the 18px width and the hit-area maths but never the 48.
- minimal failure scenario: collapse the navigation panel on a mouse: the 48px handle is the only control on screen whose height is not a named step; a future editor matching the scale to it has no token to read.
- confidence: low-medium (an intentionally taller grab affordance is plausible - flagged as an unnamed escape, not as a wrong size)

## F8 The context sheet styles headings it cannot reach ('.sheet-body h2' is inert)
- file:line: src/client/src/components/appShell/ContextSwitcherSheet.ts:95 ('.sheet-body h2 { margin: 0 0 var(--pi-space-2); font-size: var(--pi-text-sm); ... }'); the h2 elements live inside each list's shadow root: pi-web-plugins/machines/browser/MachineList.ts:106, pi-web-plugins/workspaces/browser/ProjectList.ts:89, styled by the host's listStyles adopted as constructed sheets (pi-web-plugins/machines/browser/hostUi.ts:38, pi-web-plugins/workspaces/browser/hostUi.ts:38)
- surface: context-sheet
- finding: the rule targets h2 descendants in the sheet's own shadow tree, but the only h2s render inside machine-list/project-list/workspace-list shadow roots, so the selector matches nothing; the intended 13px semibold sheet heading never lands and the headings actually render at listStyles' 12px (shared.ts:276). The visible sheet is consistent - but by accident of the shared rule, not by this surface's declared intent.
- minimal failure scenario: an editor "fixes the sheet heading size" at ContextSwitcherSheet.ts:95 and sees no change in any browser; the real rule is three files and a plugin boundary away.
- confidence: high that the rule is inert (shadow boundary); the visual result is currently benign
