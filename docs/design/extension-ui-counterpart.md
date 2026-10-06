# Extension UI: the PI WEB counterpart of pi's `ctx.ui`

Status: approved by the owner (2026-10-04), with two additions: several
extensions writing at once, and what happens when a surface has no room. Both
are the section "Many writers, little room".

## Why

An extension talks to its user through `ctx.ui` (`ExtensionUIContext`, pi
0.99.2 `core/extensions/types.d.ts`). pi has two hosts for it: the terminal UI
(`InteractiveMode`) and RPC mode, whose `extension_ui_request` protocol is pi's
own statement of what a non-terminal host should forward: `select`, `confirm`,
`input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle` and
`set_editor_text`.

PI WEB today answers four members itself (`notify`, `custom`, `confirm`,
`select`, `input`, plus a plain `theme`) and lets every other member fall to
pi's headless defaults, which do nothing. Two results the owner reported:

- `notify` draws a full system card per call, and the next call adds another
  card. pi draws one dim line that the next status replaces
  ("Ponytail loaded: full").
- A custom screen that builds pi's own components (pi-updater's
  `BorderedLoader`) dies with `Theme not initialized`, because those components
  read pi's global theme, which only the terminal host initializes.

The rule this design follows: **every `ctx.ui` member has one PI WEB
counterpart that behaves like pi's terminal host, scoped to its session.** Where
the terminal behaviour depends on a terminal (raw keys, component factories that
replace pi's own chrome), the member keeps pi's headless default and the
extension docs say so.

## Lifetime and scope

pi's terminal host has one process, one screen and one reader. PI WEB has one
long-lived daemon per machine and any number of browsers on a session. So each
counterpart names where its state lives:

| Kind | Lives in | Seen by | Survives a reload | Ends |
|---|---|---|---|---|
| Momentary (`notify`) | the frame only | every browser attached at that moment | no, as in pi | replaced or scrolled away |
| Standing (`setStatus`, `setWidget`, `setWorking*`, `setHiddenThinkingLabel`, `setTitle`) | the daemon, per session, keyed | every browser, now and on attach (snapshot) | yes, while the session's runtime lives | the extension clears it, or the runtime is disposed |
| Asked (`select`, `confirm`, `input`, `editor`, `custom`) | the daemon's dialog store (D2) | every browser | yes (a docked card) | answered, cancelled or timed out |

Every standing value carries its session (machine + session id); a browser
never draws one for a session it is not showing.

## Members

### Momentary

- **`notify(message, "info")`** - one dim line at the end of the transcript,
  without a card, header or actions. If the last thing in the transcript is
  still the previous info line, the new one replaces it in place; otherwise it
  is a new line. Nothing is saved: a reload or another device opening later does
  not show it. This is exactly pi's `showStatus`.
- **`notify(message, "warning" | "error")`** - one line in the warning or error
  colour, prefixed `Warning:` / `Error:`, appended (never replaced), not saved.
  This is pi's `showWarning` / `showError`.
- The daemon's notification store keeps recording every notify as today (it is
  what a future notification inbox reads); only the transcript drawing changes.

### Standing

- **`setStatus(key, text)`** - pi shows extension statuses in its footer. PI
  WEB's counterpart is the session footer (the line with tokens, ctx and cost):
  each key's text joins it, sorted by key as pi's footer sorts them (newlines
  and tabs flattened, as pi does); `undefined` removes that key.
- **`setWidget(key, lines, { placement })`** - a plain text block above or below
  the composer, keyed. The factory form renders through the same headless
  harness as `custom` (component to lines), re-rendered when the component asks.
- **`setWorkingMessage(message)`** - replaces the activity dock's working words
  while the agent runs; no argument restores PI WEB's own words.
- **`setWorkingVisible(false)`** - hides the dock's working row; `true` shows it.
- **`setWorkingIndicator({ frames })`** - one frame: a static mark; no frames:
  no mark; omitted: PI WEB's default.
- **`setHiddenThinkingLabel(label)`** - the label of a folded thinking block.
- **`setTitle(title)`** - the browser tab title while that session is the open
  one; leaving the session restores PI WEB's title.

### Asked

- **`select`, `confirm`, `input`** - unchanged: docked cards (D2), with the
  declared-screen and refusal rules already built.
- **`editor(title, prefill)`** - new: a docked card with a multi-line text area,
  prefilled, Submit and Cancel. Today it is pi's headless default (cancelled).
- **`custom(factory)`** - unchanged rendering (frames as lines), plus the theme
  fix below.

### Composer

- **`setEditorText(text)` / `pasteToEditor(text)`** - write that session's
  composer draft in every browser showing it (paste inserts at the caret where
  there is one, otherwise appends).
- **`getEditorText()`** is synchronous, and the daemon cannot ask a browser
  synchronously. It returns the last text this session's extensions set, or
  `""`. The extension docs say so.

### Theme

- **`theme`** stays the plain-text theme (no colour codes reach the browser).
- **pi's global theme** (`Symbol.for("@earendil-works/pi-coding-agent:theme")`,
  which every copy of pi's package reads, including an extension's own bundled
  copy) is set to the same plain-text theme once at daemon start. pi's
  components (`BorderedLoader`, `DynamicBorder`, key hints) then render instead
  of throwing.
- `getAllThemes`, `getTheme`, `setTheme`: headless defaults. PI WEB's look is
  chosen in Settings, not by an extension.

### No counterpart (headless default, documented)

`onTerminalInput` (raw terminal keys), `setFooter`, `setHeader`,
`setEditorComponent` / `getEditorComponent` and `addAutocompleteProvider` replace
pi's own terminal chrome with terminal components. PI WEB has its own chrome, so
these stay no-ops. `getToolsExpanded` / `setToolsExpanded` stay headless until a
reader asks for an extension to drive the tool fold.

## Many writers, little room

pi's `ctx.ui` does not say which extension is calling, and every extension of
a session shares one UI context. So writers are told apart only by the key they
choose, exactly as in pi's terminal.

**Keyed slots** (`setStatus`, `setWidget`): one value per key; a second write
to the same key replaces the first; `undefined` removes it. Statuses sort by
key, as pi's footer does, so a status does not jump when another one changes;
widgets keep the order in which their keys were first set.

**Single slots** (`setWorkingMessage`, `setWorkingVisible`,
`setWorkingIndicator`, `setHiddenThinkingLabel`, `setTitle`): the last write
wins, and a reset restores PI WEB's default even if another extension set the
value. That is pi's rule; PI WEB does not invent a stack pi does not have.

**Room**, per surface:

| Surface | Limit | When it does not fit |
|---|---|---|
| Footer statuses | a line of their own above the session's numbers; each status at most 40 characters (ellipsis) | the line ends in an ellipsis; tapping it lists every status in full, one per line, scrolling past 40% of the viewport |
| Widgets | each at most 6 lines (10 on desktop); all widgets together at most a third of the viewport | a longer widget shows its first lines and "Show all"; the widget area scrolls inside itself, the transcript never moves for it |
| Working words | one line in the activity dock | ellipsis; the full text in the dock's title |
| Info notify line | one line in the transcript | wraps up to 3 lines, then ellipsis; the full text in its title |
| Warning / error lines | appended | the same message again within 10 seconds becomes "×n" on the existing line instead of a new line |
| Tab title | the browser's | as the browser truncates |

## Wire

One frame family, `extension.ui`, on the session event stream:

- `{ type: "extension.ui", kind: "notify", level, message }` (momentary);
- `{ type: "extension.ui", kind: "standing", key, slot, value | null }` where
  `slot` is `status | widget | working | thinkingLabel | title`;
- `{ type: "extension.ui", kind: "editorText", text, mode: "set" | "paste" }`.

The session snapshot a browser reads on attach carries the standing map, so a
reload and a second device draw the same footer, widgets and working words.
`command.output` keeps its current meaning for command results; `notify` stops
using it.

## As built (2026-10-05)

- Step 2 (`notify`): `d15204fa`. Step 3 (standing values): this section.
- Standing values ride on the session status (`SessionStatus.extensionUi`)
  rather than an `extension.ui` "standing" frame: the status is already the
  snapshot a browser reads on attach and the frame it applies live, so one
  carrier serves both. Writes are coalesced into one status frame per 100 ms.
  The daemon keeps them per session runtime (`extensionStanding.ts`); a reload
  of the session's extensions clears them as it starts and again before the new
  session_start (pi's reset runs before its reload); the runtime's end clears
  them, and the browser drops them when the session's runtime is closed.
- Statuses have a footer line of their own above the session's numbers, as
  pi's footer gives them one: measured at 393 px, the numbers alone fill a
  phone's line and left the statuses 26 px. Each status is cut at 40
  characters, the line ends in an ellipsis, and a tap opens every status in
  full, one per line. This replaces "+n" and a separate sheet.
- `setWorkingIndicator` frames do not animate: no frames hides the mark, and
  otherwise the first frame stands as the mark.
- Widget factories render through the custom-screen harness at its width (56).
  A component draws when it calls `tui.requestRender()` or when its drawing is
  a second old, as a status is built, never on every status: pi-goal's widget
  reads a file per render, and drawing it per status put that on the daemon's
  per-chunk path. A request made while it draws is ignored.
- `setWorkingVisible(false)` hides the working row's mark and words; the turn
  clock and plugin notes stay, as pi hides only its spinner.
- `setTitle` names the tab in the chat view, with the π mark and the 40-character
  bound every tab title keeps.
- Payload bounds, never refusals: a status (and the working words, label and
  title) is cut at 1,000 characters, a widget at 100 lines of 1,000 characters,
  each saying so.

- Step 4 (`editor`, `setEditorText`, `pasteToEditor`, `getEditorText`): `editor` is a fifth dialog
  kind in the dialog store, so it docks, survives a reload, times out and settles like the others.
  Its opening text rides the status, bounded at 32,000 characters; a longer one keeps its start and
  the record counts the cut (`prefillCut`) beside the text, never in it, because the reader sends
  that text back. The card's Enter follows the composer's rule, as pi's editor follows its main
  editor's. `setEditorText` / `pasteToEditor` travel as the `extension.ui` `editorText` frame and
  write the composer of each browser showing the session through the same machine+session-checked
  path the "put it back" flows use; a paste goes in at the caret, or at the end before the editor
  is drawn. `getEditorText` answers with what the session's extensions wrote.

## Order of work

1. Theme fix (daemon only; daemon restart).
2. `notify` as pi's status line (client; web reload).
3. Standing values: `setStatus`, `setWorking*`, `setHiddenThinkingLabel`,
   `setTitle`, then `setWidget` lines, then widget factories.
4. `editor` card; `setEditorText` / `pasteToEditor`.
5. `docs/plugins.md` / extension docs: the table above.
