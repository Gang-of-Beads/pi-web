# pi's insertion points in PI WEB

Status: audit and plan, 2026-10-09. Owner, 2026-10-09: "PI WEB is generic and adapts to no particular plugin. Plugins have their scenarios; PI WEB provides a set of generic insertion points, the same philosophy as pi. pi already implements many insertion points; PI WEB's insertion points are a superset of pi's, including web UI ones that give users more on the web."

## The rule

1. **Every pi insertion point works in PI WEB without a PI WEB plugin.** An extension written for pi's terminal shows in PI WEB as it does there. Where pi draws a TUI component, the daemon renders that same component to lines (`customScreenHarness`, `renderCustomScreen`, as `ctx.ui.custom` and `setWidget` already do) and the page shows the lines.
2. **PI WEB adds web insertion points on top.** A PI WEB plugin may draw the same thing natively (message renderers, panels, pages, composer contributions). When a plugin claims something, its drawing wins over the extension's terminal drawing.
3. **Core never names an extension.** What an extension's records mean, and how its cards behave, is the extension's and its plugin's business, decided by what the extension does in pi. Only PI WEB's own product behaviour is the owner's question.

So every drawn thing resolves in one order: a PI WEB plugin's web renderer, else the extension's own pi renderer drawn to lines, else pi's default.

## Audit against the pi 1.0.4 SDK (`core/extensions/types.d.ts`)

### Things that run inside pi

`registerTool`, `registerCommand`, `registerProvider`/`unregisterProvider`, `registerVirtualModel`, `registerMcpServer`, `on(event)`, `sendMessage`, `sendUserMessage`, `appendEntry`, `exec`, `setModel`, `setThinkingLevel`, `setActiveTools`, `setSessionName`, `setLabel`, the getters, `events`: pi runs them in the session daemon exactly as in its terminal. Commands appear in the slash list (`sessionCommandService.ts`); labels in the session tree (`sessionTreeProjection.ts`). **Supported.**

`registerFlag`/`getFlag`: CLI flags; the daemon starts pi with none, so `getFlag` answers the default. **Not applicable until PI WEB has a place to set flags** (a config key would be the way; no extension needs it yet).

### Drawing

| pi insertion point | pi draws | PI WEB today | Plan |
|---|---|---|---|
| `registerMessageRenderer(customType)` | the extension's component for its custom message; else the content as markdown | a plugin's `messageRenderers` by tag; else "Nothing on this machine renders <tag>", **content not shown** | slice 1: extension renderer to lines, else the content |
| `registerEntryRenderer(customType)` | the extension's component for a `custom` entry; entries without one are not shown | **every custom entry dropped** (only PI WEB's own types projected) | slice 1: entries with an extension renderer become rows drawn to lines; plugins may claim them too |
| `registerToolRenderer`, `ToolDefinition.renderCall`/`renderResult`/`renderShell` | the extension's drawing of a tool call and its result | **ignored**: every tool drawn by PI WEB's generic tool card | slice 2: the extension's call/result drawing in the tool card |
| `registerMarkdownTransformer` | user and assistant markdown transformed before drawing | **ignored** | slice 3: applied on the daemon to the projection |
| `registerShortcut` | a key in the terminal runs the handler | **ignored**: no way to run it | slice 4: each shortcut is an action in the Actions palette, and its key where the browser lets a page have it |
| `ctx.ui.select`/`confirm`/`input`/`editor`/`custom`/`notify` | dialogs, screens, notifications | **supported** (dialog cards, custom screens drawn to lines, notifications) | none |
| `ctx.ui.setStatus` | the footer line | **supported** (session footer) | none |
| `ctx.ui.setWidget` | above or below the editor | **supported** (the extension's Go to page, owner 2026-10-07) | none |
| `ctx.ui.setFooter`/`setHeader` | replaces the footer/header with a component | **no-op** | slice 5: drawn to lines on the same Go to page as the extension's widgets (the widget rule) |
| `ctx.ui.setWorkingMessage`/`Visible`/`Indicator`, `setHiddenThinkingLabel`, `setTitle` | working row, thinking label, terminal title | **supported** | none |
| `ctx.ui.setEditorText`/`pasteToEditor`/`getEditorText` | the editor's text | **supported** (composer) | none |
| `ctx.ui.addAutocompleteProvider` | completions in the editor | **no-op** | slice 6: the composer's completions ask the daemon's providers |
| `ctx.ui.setToolsExpanded`/`getToolsExpanded` | expands all tool output | **no-op** | slice 7: the session's tool fold |
| `ctx.ui.setEditorComponent`/`getEditorComponent`, `onTerminalInput` | replaces the terminal editor; raw key input | **no-op** | later, needs its own design: the composer is a browser editor, and raw terminal keys have no counterpart |
| `ctx.ui.theme`/`getTheme`/`getAllThemes`/`setTheme` | the terminal palette | plain-text theme; `setTheme` fails | none: PI WEB's themes are its own; `setTheme` should answer that it does not apply rather than fail (slice 7) |

## Slices

Each slice: state-diagram entries for new rows or frames in the same commit, a bob review, and 8505 live checks with a real extension that uses the insertion point, old build against new.

1. **Message and entry renderers.** Built 2026-10-09. Known limit: a session read without its runtime (D5: reading a closed session never opens it) has no renderers, so rows read then show the default until the page reads the session again after it runs; drawing at `entry_appended` time and keeping the lines would lift it, if it matters in use. The daemon's projection asks the session's extension runner (`getMessageRenderer`, `getEntryRenderer`) and, when one exists, renders the component at the transcript width and ships the lines with the row (`drawn: string[]`, collapsed as pi first shows them; the expanded drawing joins slice 7), re-rendered when the transcript is read, never stored in the session file. A `custom` entry is projected only when an extension registered a renderer for its type, as in pi. The page draws, in order: a plugin's renderer for the tag, the drawn lines, the content as markdown, and only then "Nothing on this machine renders <tag>". The plugin API's message renderers also receive entry rows (`kind: "message" | "entry"`), so a plugin can draw either natively.
2. **Tool renderers.** Built 2026-10-09. The same lines for a tool call's arguments and result, in the generic tool card, when an extension draws the tool: `resolveToolRenderers` over the extension tool's own `renderCall`/`renderResult` (a built-in tool is not an extension tool, so only a resolver draws it). Live frames carry them, and the daemon keeps a call's arguments from its start to its end because pi's end event does not repeat them. Not carried over: `renderShell: "self"` (PI WEB keeps its card chrome), renderer `state` shared between a row's call and result (each drawing starts fresh), and `invalidate` (a renderer cannot ask for a redraw).
3. **Markdown transformers.**
4. **Shortcuts in the Actions palette.**
5. **Footer and header components on the widget page.**
6. **Autocomplete providers.**
7. **Tools expanded, and `setTheme` answering plainly.**
