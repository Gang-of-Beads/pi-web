# Review triage: the phone template round (5 glm lanes)

Scope: HEAD 3fc05b8c and the surfaces the owner screenshotted. Five
botim-bllm glm-5.3-flash:max lanes with split focus (shell/nav, chat,
plugin tools, overlays, tokens/theme), each adjudicating its own
suspicions from source. Standards: the bar template (44/36/8), reading
edge, uniform rows, body-is-protagonist, even line boxes, S6/S7.

## Fixed in this wave

| Lane | Finding | Adj. | Fix |
| --- | --- | --- | --- |
| 1 | P1 stray `n</button>` in the archived-session menu (a sed artefact) | TRUE | deleted |
| 1 | P1 `.compact-session` inherits the catch-all button padding → 52px in the 44px bar; press/active paint outside the bar | TRUE | `padding: 0` |
| 1 | P2 `.session-title` = 36 + 8 padding = fills the bar edge to edge | TRUE | `padding: 0` |
| 1 | P2 fine-pointer checkboxes and subtree toggles anchor 8px from the row top while text centres | TRUE | centred on fine pointers too |
| 1 | P2 status-bar figures sit on a 15px fractional line box | TRUE | line-height = control height |
| 1 | P2 `.compact-actions-row` buttons miss the even-line-box pin | TRUE | pinned |
| 2 | P1 stuck message header shows a 1px sliver; the role label disappears (sticky-top −24 paired with a now-25px header) | TRUE | `top: sticky-top + 6px`; `scripts/verify-message-header.mjs` PASS |
| 2 | P2 coarse drawer tabs/collapse fill the 44px bar at 44 | TRUE | 36px per the template |
| 2 | P2 jump-to-bottom has no coarse reach | TRUE | invisible reach pseudo-element, drawn box stays 36 |
| 2 | P2 the right rail ignores the published scrollbar width | TRUE | `right: calc(2px + var(--pi-chat-scrollbar))` |
| 3 | P1 fold toolbar buttons render 32px inside the 44px bar | TRUE | `.workspace-tool-toolbar button` pinned to 36 + disabled style |
| 3 | P2 git viewer header off-baseline | TRUE | `align-items: center` |
| 3 | P2 fold's disabled buttons unstyled (styles scoped to `.git-panel`) | TRUE | disabled rule in gitToolbarStyles |
| 3 | P2 plugin viewer insets invented (relays 24px uniform) | TRUE (relays) | reading edge; updates/info judged cosmetic-identical, deferred |
| 3 | P2 files viewer actions are the smallest controls, no coarse floor | TRUE | coarse 36px |
| 4 | P1 `.row-mark` svgs unsized → the "empty bordered boxes" in the workspace trust expansion (the owner's screenshot) | TRUE | 12px sizing in WorkspaceList styles |
| 4 | P1 workspace list prints "No workspaces here yet." during load and after failure | TRUE | `workspacesLoad` + retry through NavSectionContext; the empty claim only speaks after `loaded` |
| 4 | P2 QuickSwitcher header/footer off the bar shape | TRUE | template (44/36, inset 8); coarse controls 36 |
| 4 | P2 settings rows wrap on long plugin titles → uneven heights | TRUE | nowrap + ellipsis |
| 4 | P2 answered-dialog chip rides the dot's baseline | TRUE | `align-items: center` |
| 4 | P2 a failed trust read paints an unchecked "Trusted" — a negative claim for an unknown | TRUE | `indeterminate` while unknown |
| 5 | P2 light palette misses the shadow trio | TRUE | trio added + a dark/light colour-token parity guard in designTokens.test.ts |
| 5 | P2 `.workspace-label` defined twice, the panel copy dead and drifted | TRUE | consolidated into the listStyles copy |
| 5 | P2 `--pi-chrome-inset` consumed nowhere | TRUE | removed |
| 5 | P2 `.detail-copy` 18px on fine pointers, below the 24px floor | TRUE | 24px |
| 5 | P2 raw `16px` in the workspace menu panel width | TRUE | token math |
| 5 | P2 `.panel-header` ships no inset; every consumer remembers | TRUE | `padding-inline: var(--pi-bar-inset)` in the shared header |

## Judged not true / deferred with reason

| Finding | Adj. | Reason |
| --- | --- | --- |
| 2 | P2 collapsed↔expanded composer edge jump (base `footer.collapsed` beats the media rule) | TRUE, deferred | real; the full 641–760px gutter realignment it belongs to is its own wave |
| 2 | P2 outbox strip unstyled | needs repro | not reproduced in probes; filed for the next round with a screenshot |
| 3 | P1 four bundled tools stack a duplicate titled bar under the host header (Files/Relays/Updates/Info) | TRUE, scheduled | this is the fold migration for the remaining tools — its own task, git is the reference pattern |
| 3 | P2 the fold wraps into two rows on a phone | deferred | wrap is the escape valve for five controls at 393px; revisit with compact labels |
| 3 | P2 git history rows two-line | FALSE | the established title+meta row shape |
| 5 | P2 `<a>` nested inside the workspace row button | TRUE, deferred | works in practice; restructuring the row is not a one-liner |
| 5 | P2 layer-scale guard cannot see plugins | deferred | scanned: no bundled plugin ships z-index > 9 today |
| 5 | P2 dead heading rules in SettingsAppearancePanel | report-only | no visual defect |

Verification: typecheck 0; vitest 2485 client + 634 plugin tests green;
built and restarted on 8505; `verify-message-header.mjs`,
`probe-go-to-sheet.mjs`, `probe-git-worktree-add.mjs` PASS.

## Addendum: task-6 consumer lanes (glm-mention, glm-askhere over 98d18e5f/4d0a0c13)

| Finding | Adj. | Fix |
| --- | --- | --- |
| M-F1 P1: the mention chip guarded on the remembered mode while code files render raw regardless — after any Preview preference every code file lost the chip | TRUE | the guard now asks what is on screen (`showsRawSource`: code kind always, dual-mode only in raw) |
| M-F2 P1: `@my file.ts:3-5` unquoted, breaking the whitespace-delimited @ grammar | TRUE | paths with a space quote like the composer's own `fileCompletionInsertText`: `@"my file.ts":3-5` |
| A-F1 P1: the quote chip survived a session switch — tapping it wrote session A's words into session B's composer | TRUE | `quoteChip` cleared in `prepareSessionUiState` beside `heldWaiting` |
| A-F2 P1: Ask-here inserted at doc end; the confirmed wording and the sibling feature say cursor | TRUE | routes through `createPromptEditor().insertText` (cursor, focus, replaces selection) |
| A-F3 P1 (applied to mention side): chip position unclamped; an unrendered selection end pinned it top-left | TRUE | `selectionLines` returns undefined when CM cannot produce coords; the viewport clamp sits with the reviewer's target next pass |
| M-F4/A-F8 P2: `mentionLineRange` dead production code | TRUE | deleted with its test (CM's `doc.lineAt` is the producer) |
| M-F5 P2: CodeViewer built the editor twice per mount | TRUE | dropped the duplicate `firstUpdated` build |
| A-F4 P2: the mention chip read CM's state one `selectionchange` early | TRUE | the read defers one microtask, after CM's own listener |
| A-F5 P2: the transcript chip kept a stale fixed anchor while scrolling | TRUE | scrolling clears the chip honestly (reselect to re-ask) |
| A-F6 P2: tap silently lost the quote before the composer view mounted | deferred | the composer mounts with the chat surface; a real gap only if the editor is unmounted mid-session |
| A-F7 P2 multi-range selections anchor to range 0 | report-only | Firefox Ctrl-drag shape |
| Lanes' FALSE adjudications (CM selection with readOnly, double-insert, stale A→B→A chip, listener leaks) | FALSE | verified from source incl. the installed CodeMirror dist |

Live: rebuilt 8505; `scripts/probe-selection-composers.mjs` PASS (both flows).

## Addendum: task-8/9 lanes (fold migration, uiShared, adoption regression)

Regression first: 96a0eaea added adoptSheets to the PluginHostUi contract
without implementing it on the runtime object — every plugin wrapper
routing adoption through the host silently no-opped, and the context
sheet rendered unstyled (the owner's "不能要了" screenshot). Fixed in
3a159233; the three lanes below then reviewed the whole seam.

| Finding | Adj. | Fix |
| --- | --- | --- |
| fold P1-1: files "stale" summary false after every settle (invalidate clears, then the emit re-marks; the landed refetch never clears) and across machine switches | TRUE | flag clears when the refetch lands and on context reset |
| fold P1-2: relays summary never appears after a scan and can show the previous mount's relay | TRUE | disconnectedCallback releases the active slot; scan/refresh land → host render |
| uishared 1 / sheet F1 P1: no test at the adoption seam (the one adoption assertion ran against a fake host) | TRUE | pluginHostUi.test asserts both hand-outs and that adoptSheets lands rules in a real shadow root, replacing on re-adoption |
| uishared 2 / sheet F2 P2: machines hostUi kept a private cssResultSheets copy | TRUE | routes through the host's adoptSheets |
| uishared 3 / sheet F3 P2: adoptSheets' replace was dead code | TRUE | per-root WeakMap replacement |
| uishared 4 P2: adoptSharedControls had zero consumers | TRUE | retired from the contract; the mechanism (adoptSheets) is the seam |
| uishared 5 P2: files' textStyles drag dead-ened the panel host shape | TRUE | text styles move to the viewer, which renders markdown |
| fold P2-D: dead chrome (files .toolbar-actions, relays data-refresh branch) | TRUE | removed |
| fold P2-E: blank picker row with zero relays | TRUE | toolbar hidden when the picker is empty |
| fold P2-F: workspace-tasks still stacked its own bar | TRUE | migrated: Refresh + Open Terminal in the fold |
| sheet F4 P2: doc/CSS described a machines section the sheet cannot render | TRUE | doc and dead rule fixed |
| sheet F5 P2: barTemplate enumeration misses relays' picker row | report-only | the picker row is not a bar post-migration |
| sheet F6 P2: stale narration in ProjectDialog | report-only | comment-only |
| fold P2-C: changeset said Updates count as summary but a badge exists | FALSE | the summary is implemented; the badge is the pre-existing tool-row chip |

Live: rebuilt 8505; probe-tool-fold, probe-selection-composers,
probe-workspace-watch, probe-git-worktree-add, verify-message-header all
PASS.
