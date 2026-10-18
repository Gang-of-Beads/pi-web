# Pi extensions under PI WEB

Pi extensions are modules Pi loads into each session: they register tools, commands, hooks, renderers and model providers through Pi's extension API. Under PI WEB they run in the session daemon, and PI WEB draws what they ask of `ctx.ui` in the browser. This page says how each part of that API behaves in PI WEB.

PI WEB plugins are a different thing, with their own API; see [PI WEB plugins](plugins.md). A PI WEB plugin can draw an extension's custom messages or tool calls its own way, or front an extension with a page of its own.

## Pi extension dialogs in PI WEB

Pi extensions running under PI WEB's session daemon can ask the user questions with `ctx.ui.confirm()`, `ctx.ui.select()`, `ctx.ui.input()`, and `ctx.ui.editor()`. PI WEB reports `ctx.hasUI === true`, and for these dialog methods that is true in fact: the call renders a dialog card inline in the session transcript and the returned Promise resolves with the user's actual answer — a boolean for confirm, the chosen option for select, the typed text for input and editor.

- **Works from hooks, without the prompt queue.** Answers travel over a dedicated session-daemon channel, so a dialog opened inside an in-flight `tool_call` hook parks safely — the agent loop waits for the hook and the run continues with the answer. Consent-gating a tool from a `tool_call` hook is a supported pattern.
- **`session_start` dialogs are reachable.** A dialog opened from a `session_start` hook is answerable while the session is still starting, both when creating a session and when opening an existing one; startup completes once the dialog settles.
- **Survives browser reloads; first answer wins.** Reloading the browser re-renders open dialogs from the session status. With several tabs on the same session, the first answer settles the dialog and the other tabs re-render the settled card.
- **Settled cards stay until dismissed.** An answered or closed dialog leaves its outcome card in the transcript so the user can see what became of it — answers travel to the extension alone, so the card is the only record of the exchange. The card is browser-local: only a browser that saw the dialog open renders it, and switching sessions or reloading drops it.
- **Timeouts.** The extension's own `timeout` option applies, and the daemon offers an unattended-dialog safety valve, `extensionDialogsTimeoutMs` (default `0`, which waits indefinitely; set a positive number of milliseconds to auto-cancel — see [Extension dialogs](config.md#extension-dialogs)). The effective deadline is the sooner of the two. A dialog that closes without an answer resolves with its kind's cancel value: `false` for confirm, `undefined` for select, input and editor.
- **Abort and runtime replacement.** Aborting the current run settles a dialog opened during that run immediately, at abort-request time, with its cancel value. Replacing the session runtime (`/reload`, session disposal) settles any still-open dialog the same way; hooks on the new runtime open fresh dialogs. `/new` replaces the session the same way, at once even while the agent works: a `session_before_switch` handler that returns `{ cancel: true }` cancels the switch before anything is stopped; otherwise the run stops as on Stop, which settles the run's dialogs, the old session's extensions get `session_shutdown` with reason `new`, and a dialog that the new session's `session_start` opens shows on the new session, where every browser that showed the old one has already moved. The extension's own `AbortSignal` is honored: aborting it dismisses the dialog and resolves with the cancel value.
- **`custom` draws a card.** A terminal screen opened with `custom` is drawn as a card in the conversation: a menu as choices with Confirm, anything else as its text with a text field. The text is drawn in the app's font, its roles (`accent`, `dim`, the selected row…) in the app's colours, without the component's box drawing or key-hint row, under the extension's name, at the width of the card (the component is drawn at the columns the card has room for, as pi's terminal draws at its width): the `theme` the factory receives marks the roles, and pi's own components inside the screen draw with it too. The field types into the component as you type (what you delete goes as Backspace), so a list that searches as you type follows it, and Send presses Enter; tapping a line moves the component's cursor to that item, one key at a time, and selects it; a tap on no item selects nothing. Cancel first gives the component the Esc pi's terminal sends, so a screen that closes itself on Esc ends as it would in pi. There are no arrow-key buttons; on a keyboard, keys reach the screen while it has focus. The component receives keys as pi's terminal sends them and reads pi's own keybindings. A screen declared with `web: { kind: "card", fields: [...] }` is drawn as an interactive card and its terminal component never mounts; see [Interactive cards](#interactive-cards). `ctx.ui.piWebScreens` lists the declarations this host draws.
- **Every dialog is shown, as pi's terminal shows it.** An empty title gets a generic heading, a select with no options says so and offers Cancel, repeated and blank options are listed as given, and any number of options is shown. Only the status payload is bounded: a title or message longer than 32,000 characters is cut, and the cut says how much is missing. A dialog kind PI WEB does not know rejects the extension's call, and the open conversation says that an extension asked something PI WEB could not show.
- **`notify` is a status line in the conversation.** An info notice replaces the previous info line while that line is still the last thing in the conversation; a warning or an error is kept, and a repeat within ten seconds counts up instead of adding a line. Notices are momentary: a browser that was not open, or that reloads, does not see them.
- **Standing values are drawn, and every open browser sees them.** `setWorkingMessage` changes the working row's words and `setWorkingIndicator` its mark (no frames hides it; otherwise the first frame stands still); `setWorkingVisible(false)` hides both, and the turn clock stays. `setHiddenThinkingLabel` labels a folded thinking block, and `setTitle` names the browser tab, after the π mark, while that session is open in the chat view. The daemon holds these values per session, so a browser that opens or reloads the session reads them as they stand; reloading the session's extensions clears them, as in pi, and so does closing the session's runtime. Each text is bounded at 1,000 characters.
- **`setStatus` is drawn in the status bar where there is room.** The bar reads, from the left: tokens in and out, the context, the extensions' statuses, and the cost at the right edge. Statuses are joined with spaces in key order, as pi's footer joins them, and cut with an ellipsis when the line runs out; when there is no room for them, on a phone for instance, they are left out. Hovering the line shows them in full. PI WEB favours no extension: every status is drawn the same way.
- **`setWidget` is the extension's own page in Go to.** Nothing is drawn around the composer or in the conversation. From an extension's first widget in a session, Go to has a key for that extension; its page shows each of its widgets under its key, as the terminal draws it, and follows every update. A cleared widget leaves the key, and the page says the extension shows nothing now, until the session's extensions reload. The key is named by `piWeb.title` in the extension package's `package.json` (`{ "piWeb": { "title": "Web activity" } }`), else the package's name, else the extension file's. An extension whose tools a PI WEB plugin's page fronts (the page's `fronts`, matching its server half's `agentFacts.surfaces`; see [Plugin API reference](plugin-api.md#agent-facts)) brings no key of its own: the plugin's page stands for it. PI WEB tells which extension called from the call itself, since pi gives every extension the same `ctx.ui`; a call it cannot match stands under its widget key.
- **`editor` is a text card, and the composer methods write the composer.** `editor(title, prefill)` opens a card with a multi-line text area holding `prefill`; Send returns the text and Cancel `undefined`, and Enter follows the composer's Enter setting (it sends on a keyboard and starts a new line on a touch screen unless the reader chose otherwise). An opening text longer than 32,000 characters is cut, and the card says how many characters it cut. `setEditorText` replaces the session's composer text and `pasteToEditor` puts its text in at the caret, in every browser showing the session at that moment; like `notify`, a browser that opens the session later does not get it. A write that lands while a browser is still opening the session can be missed there. `getEditorText` cannot read a browser's draft: it returns what the session's extensions wrote (a paste joins the end), or `""`; like pi's composer, that text outlives a reload of the session's extensions, and a message or command sent from the composer empties it, as pi's editor empties on submit. A browser loaded before PI WEB knew `editor` draws no card for it: reload the page, or the dialog waits until `extensionDialogsTimeoutMs` ends it.
- **`setHeader` and `setFooter` are on the extension's page in Go to**, with its widgets: the header first, the footer last. A session has one of each, the last extension to set one replacing the one before, as in pi; a footer factory's `footerData` answers the git branch, the statuses and how many providers have models.
- **`addAutocompleteProvider` completes in the composer.** Wherever pi's editor would ask its providers (`/` opening a line, `@`, `#` or a provider's `triggerCharacters` opening a word), the composer asks the session's providers alongside its own completions, and their items win when there are any; picking one applies it with the providers' `applyCompletion`. Tab does not force a completion.
- **`setToolsExpanded` opens the session's tool output**, as pi's Ctrl+O does: the session's tool cards open, and what the extensions draw from then on is drawn expanded; `getToolsExpanded` answers it. `setTheme` answers that it does not apply: PI WEB draws with its own themes.
- **`onTerminalInput` gets Esc.** Esc pressed in the chat view that nothing on the page used (no open dialog, menu or completion list) reaches the session's listeners as pi's byte for Esc, in the order they were added; other keys do not, and a listener cannot stop the page from using a key first.
- **`setEditorComponent` is still a no-op** under PI WEB even though `hasUI` is `true`; do not rely on `hasUI` alone to detect it.

### `ctx.ui` at a glance

| Member | In PI WEB |
| --- | --- |
| `confirm`, `select`, `input` | A docked card in the conversation; resolves with the answer, or the kind's cancel value. |
| `editor` | A card with a multi-line text box holding the extension's text; resolves with the edited text, or `undefined`. |
| `custom` | A card: a menu as choices with Confirm, anything else as its text in the app's own colours, a tap selecting the tapped item, with a field that types into it; Cancel sends Esc first. A screen declared with `web: { kind: "card" }` is an interactive card. |
| `notify` | One line in the conversation; info replaces the previous info line, warnings and errors are kept. |
| `setWorkingMessage`, `setWorkingVisible`, `setWorkingIndicator` | The working row's words and mark while the agent runs. |
| `setHiddenThinkingLabel` | The label of a folded thinking block. |
| `setTitle` | The browser tab title while the session is open in the chat view. |
| `setEditorText`, `pasteToEditor` | The session's composer, in every browser showing it. |
| `getEditorText` | What the session's extensions wrote since the last message or command was sent, or `""`; a browser's own draft cannot be read. |
| `theme` | A plain-text theme: no colour codes reach the browser. pi's own components that read the global theme render. |
| `setStatus` | The status bar, between the context and the cost, where there is room; left out when there is none. |
| `setWidget` | The extension's own page in Go to, named by `piWeb.title` in its package; none when a plugin's page fronts it. Never around the composer. |
| `setHeader`, `setFooter` | On the extension's page in Go to with its widgets, header first and footer last; one of each per session, the last set winning, as in pi. |
| `addAutocompleteProvider` | The composer's completions, asked where pi's editor would ask; the providers' items win when there are any. |
| `onTerminalInput` | Gets Esc pressed in the chat view that nothing on the page used; no other key. |
| `setEditorComponent`, `getEditorComponent` | No effect: they replace pi's terminal editor, and PI WEB's composer is its own. |
| `getAllThemes`, `getTheme` | pi's headless defaults (none): PI WEB's look is chosen in Settings. |
| `setTheme` | `{ success: false }`, saying PI WEB draws with its own themes, chosen in its Settings. |
| `getToolsExpanded`, `setToolsExpanded` | The session's tool cards open their output while it is set, and what the extensions draw from then on is drawn expanded. |

### Custom messages and entries

An extension's own renderers draw its rows, as in pi's terminal:

- **`registerMessageRenderer`**: a custom message sent with `display: true` is drawn by the extension's renderer, as plain lines. Without one it shows its type and its content, as pi's default does. A PI WEB plugin that claims the type with a [message renderer](plugin-api.md#message-renderers) draws it its own way instead.
- **`registerEntryRenderer`**: a custom entry written with `appendEntry` is shown only when an extension registered a renderer for its type, drawn by that renderer, live and after a reload. Other custom entries stay extension state and are not shown.
- **Tool renderers**: a tool an extension registers with `renderCall` or `renderResult`, or a tool an extension's `registerToolRenderer` resolver draws, shows that drawing in its tool card: the call's lines as its input, the result's lines as its result. pi's built-in tools keep PI WEB's own cards unless a resolver draws them. Each drawing starts with fresh renderer `state`.
- **`registerMarkdownTransformer`**: a user message, an assistant reply and its thinking are drawn as the extensions' markdown transformers change them, once the text is finished; copying or quoting a message still takes what was said. A reply in progress shows its own text until it ends.
- **`registerShortcut`**: each shortcut of the open session is an action in the Actions palette under Extensions, named by its description and its extension, and runs its handler in the session with the context pi gives it; a handler that throws says so in the conversation. Its key is bound unless PI WEB already uses it, it has no Ctrl, Cmd or Alt, or it has Ctrl or Cmd alone (the browser's); Settings → Keyboard can give it any key.
- The renderers live in the session's runtime. A session PI WEB reads without starting it (a closed session) has none: its custom messages show their content, and its custom entries are not shown until the session runs and the page reads it again.

One browser-local caveat: reloading the browser while a new session is still being created loses the browser-local pending-start row, so the dialog card disappears from view. The daemon-side dialog still settles at its deadline and the session appears in the sidebar once creation completes.

## The extension's name in PI WEB

PI WEB names an extension (its key in Go to, a dialog card's heading) by `piWeb.title` in the `package.json` of the Pi package that carries it, else by the package's name, else by the extension file's name:

```json
{ "piWeb": { "title": "Web activity" } }
```

## Model providers

PI WEB shares one model runtime across all sessions. It captures the providers that global extensions register when the session daemon starts; a later attempt to add or replace a provider, including from a project extension or after `/reload`, is ignored. See [Pi extension provider baseline](config.md#pi-extension-provider-baseline).


### Interactive cards

An extension can declare what its `ctx.ui.custom` screen is, so PI WEB draws it as a card of its own instead of the terminal component. pi ignores the `web` option and keeps drawing the component in its terminal.

```ts
const value = await ctx.ui.custom(factory, {
  web: {
    kind: "card",
    title: "Which plan?",
    submit: "Send",
    fields: [
      { type: "text", id: "why", text: "Both plans keep the API; B also moves the store." },
      { type: "choice", id: "plan", label: "Plan", options: [{ value: "a", label: "Plan A" }, { value: "b", label: "Plan B" }], other: "choice", required: true },
      { type: "input", id: "note", label: "Anything else?", multiline: true },
      { type: "confirm", id: "push", label: "Push when done?", confirm: "Push", decline: "Keep local" },
    ],
  },
});
// { values: { plan: { selected: ["b"] }, note: { text: "..." }, push: { confirmed: true } } }, or undefined when closed unanswered
```

| Field | Draws | Value |
|---|---|---|
| `text` | Read-only text shown with the field after it | none |
| `choice` | Options, one or several (`multiple`); `other: "choice"` adds a Custom option that opens a box, `other: "field"` a box under the options | `{ selected, other? }` |
| `input` | One line, or a box (`multiline`), with an optional `placeholder` | `{ text }` |
| `confirm` | Two choices, `confirm` and `decline` ("Yes" and "No" when absent) | `{ confirmed }` |

- The card is headed by `title`, or by the extension's name when it declares none. It shows one answerable field at a time, numbered, with Back and Next, and sends from the last one; `submit` names that button ("Send" when absent). Cancel closes it unanswered, and `custom()` resolves with `undefined`.
- A field with `required: true` must be filled before the card moves past it; other fields may be left untouched and are then absent from `values`. Sending with untouched fields asks once ("Send without answering: …?").
- The card keeps what the reader entered across a reload, in that browser, until the card closes.
- Bounds: 20 fields, 12 options a choice, 1,000 characters a label, 4,000 characters of typed text. A declaration that does not fit is refused, and the terminal screen is drawn instead; the session daemon's log says why.
- `ctx.ui.piWebScreens` lists `"card"` when the host draws cards, so an extension can tell "closed unanswered" from "no card here" before it asks again another way.

