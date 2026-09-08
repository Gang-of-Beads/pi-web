# Research: Plugin/extension architecture for PI WEB, and compatibility with Pi coding-agent extensions

> **Tooling limitation, stated up front.** This run had only file `Read`/`Write` tools. No `web_search`, no `web_fetch`, and no `source_check` were registered for this agent. Therefore:
> - Every claim about **Pi** and about **PI WEB** below is *direct evidence* read from files on this machine (paths and line-anchored quotes given).
> - Every claim about **other ecosystems** (VS Code, Obsidian, Figma, Zed) is **UNVERIFIED in this run**: it is prior knowledge with the canonical documentation URL supplied so it can be checked. Treat those as hypotheses to confirm before they carry a decision. They are marked `[UNVERIFIED]` individually.

## Summary

Pi's extension model is a single activation function handed one capability object (`ExtensionAPI`), and everything an extension contributes — tools, commands, shortcuts, CLI flags, model providers, event hooks, custom messages/entries plus their renderers, and UI — is *declared through that object*, never wired into pi's internals. Of its UI surface, exactly nine methods are already defined as a transport-neutral request/response protocol by pi itself (`extension_ui_request` in RPC mode); `ui.custom()` and the component-factory methods are terminal-only by pi's own statement and are unbridgeable without re-implementing a TUI. PI WEB should therefore (a) implement the nine RPC-defined methods over the surfaces it already has rather than inventing a schema, (b) make `ctx.mode`/capability reporting *honest* instead of the current `hasUI === true` while widgets/status are silently no-ops, and (c) close the contract gaps where PI WEB's own plugin model has drifted from — or lags — pi's: no browser-plugin storage, no project-local plugin discovery, no declared capability manifest, and a public doc that describes 3 contribution types while the shipped `src/plugin-api.ts` ships 11.

---

## Part 1 — What a Pi extension can contribute today

**Source (primary, on this machine):** `/Users/hanxiao.du/Desktop/vincent/projects/pi-web/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` (3024 lines, read in full across three passes), `.../docs/rpc.md`, `.../README.md`. Package version: `@earendil-works/pi-coding-agent` is a devDependency at `^0.85.0` and a peerDependency at `>=0.84.0` (`package.json`). **Support: direct evidence. Confidence: high.**

The activation seam is one function:

```typescript
export default function (pi: ExtensionAPI) { ... }   // may be async; pi awaits it before startup continues
```

### 1.1 Tools (LLM-callable)

| Capability | API | Notes from the doc |
|---|---|---|
| Register a tool | `pi.registerTool({ name, label, description, parameters, execute })` | Works during load **and after startup** (from `session_start`, commands, other handlers); "New tools are refreshed immediately in the same session … callable by the LLM without `/reload`." |
| Prompt integration | `promptSnippet`, `promptGuidelines` | Snippet = one line in "Available tools"; guidelines = bullets appended flat to Guidelines while the tool is active. |
| Schema | `typebox` `Type.Object`, `StringEnum` from `@earendil-works/pi-ai` | `Type.Union`/`Type.Literal` "doesn't work with Google's API". |
| Backward compat | `prepareArguments(args)` | Runs before schema validation, to accept an older stored tool-call shape on resumed sessions. |
| Streaming | `onUpdate?.({ content, details })` | Partial results. |
| Result | `{ content, details, usage?, terminate? }` | `content` goes to the LLM; `details` is for rendering + state reconstruction; `usage` folds nested LLM calls into session totals; `terminate: true` skips the follow-up LLM call **only if every finalized result in the batch terminates**. |
| Errors | throw from `execute` | "Returning a value never sets the error flag regardless of what properties you include." |
| Override built-ins | register same name as `read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`/`powershell` | Renderer inheritance is **per slot**: omit `renderCall` and the built-in `renderCall` is used; same for `renderResult`. `promptSnippet`/`promptGuidelines` are **not** inherited. |
| Remote execution | `createReadTool(cwd, { operations })`, `createBashTool(cwd, { spawnHook })`, `ReadOperations`/`BashOperations`/… | Delegating built-in tool bodies to SSH/containers. |
| Concurrency safety | `withFileMutationQueue(absolutePath, fn)` | Required for file-mutating custom tools because tool calls run in parallel by default; without it two tools read the same old contents and the last write wins. |
| Truncation | `truncateHead`/`truncateTail`, `DEFAULT_MAX_BYTES` (50KB), `DEFAULT_MAX_LINES` (2000) | "Tools MUST truncate their output." |
| Active set | `pi.getAllTools()`, `pi.getActiveTools()`, `pi.setActiveTools(names)` | Purely-additive changes enable native deferred loading (Anthropic `defer_loading`/`tool_reference`; OpenAI `tool_search_call`); non-additive changes fall back to sending the full list. |

### 1.2 Commands, shortcuts, flags

- `pi.registerCommand(name, { description, handler, getArgumentCompletions })`. Duplicate names are **kept, not rejected**: "pi keeps them all and assigns numeric invocation suffixes in load order, for example `/review:1` and `/review:2`."
- `pi.registerShortcut("ctrl+shift+p", { description, handler })`; `pi.registerFlag(name, { type, default })` + `pi.getFlag(name)`.
- `pi.getCommands()` returns `{ name, description?, source: "extension"|"prompt"|"skill", sourceInfo: { path, source, scope: "user"|"project"|"temporary", origin: "package"|"top-level", baseDir? } }`. The doc states: **"Use `sourceInfo` as the canonical provenance field. Do not infer ownership from command names or from ad hoc path parsing."**
- Command handlers get `ExtensionCommandContext`, a strict superset of `ExtensionContext` with session-control methods that "are only available in commands because they can deadlock if called from event handlers": `waitForIdle()`, `newSession()`, `fork(entryId)`, `navigateTree(targetId)`, `switchSession(path)`, `reload()`, `getSystemPromptOptions()`.

### 1.3 Prompts / skills / themes contributed by an extension

`resources_discover` (fires after `session_start`, `reason: "startup" | "reload"`) lets an extension return `{ skillPaths, promptPaths, themePaths }`. So prompt templates, skills and themes are *discoverable resources an extension can point at*, not objects it registers.

### 1.4 Events — the full published set

Startup: `project_trust`. Resources: `resources_discover`. Session: `session_start`, `session_info_changed`, `session_before_switch`, `session_before_fork`, `session_before_compact` / `session_compact` / `session_compact_failed`, `session_before_tree` / `session_tree`, `session_shutdown`. Agent: `before_agent_start`, `agent_start`, `agent_end`, `agent_settled`, `ui_prompt_start` / `ui_prompt_end`, `turn_start` / `turn_end`, `message_start` / `message_update` / `message_end`, `tool_execution_start` / `_update` / `_end`, `context`, `before_provider_headers`, `before_provider_request`, `after_provider_response`. Model: `model_select`, `thinking_level_select`. Tool: `tool_call`, `tool_result`. Bash: `user_bash`. Input: `input`.

**Which of these are *hooks that can change outcomes*, not just announcements** (this is the load-bearing distinction for PI WEB's own design, which deliberately publishes read-only facts):

| Event | Power granted |
|---|---|
| `project_trust` | Returns `{ trusted: "yes"\|"no"\|"undecided", remember? }`; first yes/no wins and **suppresses the built-in trust prompt**. |
| `input` | `{ action: "continue" \| "transform" \| "handled" }` — `handled` skips the agent entirely. |
| `before_agent_start` | Injects a persistent message and/or **replaces the system prompt**, chained across extensions. |
| `context` | Returns replacement `messages` for the LLM call. |
| `tool_call` | `{ block: true, reason?, terminate? }`; **`event.input` is mutable in place with no re-validation**. |
| `tool_result` | Middleware chain returning partial patches to `content`/`details`/`isError`/`usage`. |
| `message_end` | Returns a replacement finalized message (must keep the same `role`). |
| `session_before_switch` / `_fork` / `_compact` / `_tree` | `{ cancel: true }`, or supply a custom compaction/summary. |
| `before_provider_headers` / `before_provider_request` | Mutate headers in place (set `null` to delete); replace the outgoing payload. |
| `user_bash` | Replace bash operations, or return the result outright. |

`ctx` also carries `mode`, `hasUI`, `cwd`, `isProjectTrusted()`, `sessionManager` (read-only), `modelRegistry`/`model`/`thinkingLevel`/`scopedModels`, `signal`, `isIdle()`, `abort()`, `hasPendingMessages()`, `shutdown()`, `getContextUsage()`, `compact()`, `getSystemPrompt()`.

### 1.5 Durable content and its renderers — the part that matters most for a browser host

Two distinct channels, and the difference is the whole compatibility story:

| Channel | Producer | In LLM context? | Renderer |
|---|---|---|---|
| Custom **message** | `pi.sendMessage({ customType, content, display, details }, { deliverAs: "steer"\|"followUp"\|"nextTurn", triggerTurn })` | **Yes** | `pi.registerMessageRenderer(customType, (message, options, theme) => Component)` |
| Custom **entry** | `pi.appendEntry(customType, data)` | **No** ("Custom entries do NOT participate in LLM context") | `pi.registerEntryRenderer(customType, (entry, { expanded }, theme) => Component)` |

Also: `pi.sendUserMessage(content, { deliverAs, expandPromptTemplates })`, `pi.setSessionName` / `getSessionName`, `pi.setLabel(entryId, label)` (bookmarks visible in `/tree`), `pi.registerMarkdownTransformer(fn)` (display-only, chained, gets `messageType`/`isStreaming`/`availableWidth`), `pi.events` (an inter-extension event bus), `pi.exec(command, args, { signal, timeout })`, `pi.registerProvider` / `pi.unregisterProvider`, `pi.setModel`, `pi.get/setThinkingLevel`.

**Renderers return `Component` objects from `@earendil-works/pi-tui`** (`Box`, `Text`, …) and receive a `theme` with `fg`/`bold`/`italic`/`strikethrough`. That is the hard boundary: the *data* (`entry.data`, `message.details`) is JSON and portable; the *renderer* is a terminal component tree and is not.

### 1.6 The UI surface, split by transportability

pi itself has already drawn this line, in `docs/rpc.md` → "Extension UI Protocol". **Support: direct evidence. Confidence: high.**

**Bridgeable — blocking dialogs** (emit `extension_ui_request`, block for a matching `extension_ui_response`): `select`, `confirm`, `input`, `editor`.

**Bridgeable — fire-and-forget** (emit a request, no response expected): `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`.

**Not bridgeable — pi degrades them itself in RPC mode:**
> "`custom()` returns `undefined`; `setWorkingMessage()`, `setWorkingIndicator()`, `setFooter()`, `setHeader()`, `setEditorComponent()`, `setToolsExpanded()` are no-ops; `getEditorText()` returns `""`; `getToolsExpanded()` returns `false`; `pasteToEditor()` delegates to `setEditorText()`; `getAllThemes()` returns `[]`; `getTheme()` returns `undefined`; `setTheme()` returns `{ success: false, error: "..." }`."

And the guard pi tells extension authors to use:
> "`ctx.mode` is `"rpc"` and `ctx.hasUI` is `true` in RPC mode … Use `ctx.mode === "tui"` to guard TUI-specific features like `custom()` that require a real terminal."

Mode table (`docs/extensions.md` → Mode Behavior): `tui` (hasUI true, full), `rpc` (hasUI true, dialogs + fire-and-forget via the sub-protocol, `custom()` returns undefined), `json` (hasUI false, UI methods no-op), `print` (hasUI false).

Additional TUI-only surfaces beyond the RPC list: `ctx.ui.addAutocompleteProvider()`, `ctx.ui.custom(fn, { overlay, overlayOptions, onHandle })` with the experimental overlay positioning API, `CustomEditor` subclassing, `renderShell: "self"` tool framing, `keyHint()`/`keyText()` keybinding hints.

### 1.7 Discovery, trust, packaging, reload

- Locations: `~/.pi/agent/extensions/*.ts` and `*/index.ts` (global), `.pi/extensions/*.ts` and `*/index.ts` (project-local), plus `settings.json` `extensions`/`packages` arrays and `-e/--extension` CLI.
- **Project trust is the gate:** "Project-local `.pi/extensions` entries load only after the project is trusted." Before the decision, "pi loads only context files, user/global extensions, and CLI `-e` extensions so they can handle the `project_trust` event." Trust lives in `~/.pi/agent/trust.json`, with `defaultProjectTrust` (`ask`|`always`|`never`) for non-interactive modes; `--approve`/`--no-approve` override for one run.
- Loading is via **jiti**, so TypeScript runs uncompiled.
- `/reload` (and `ctx.reload()`) reloads extensions, skills, prompts, themes, keybindings, context files — but only for extensions in auto-discovered locations.
- Security posture, stated bluntly in the README: "Pi packages run with full system access. Extensions execute arbitrary code … Review source code before installing third-party packages."
- Lifecycle discipline the docs make explicit: **do not start background resources in the factory** ("Extension factories may run in invocations that never start a session"); start them at `session_start` and register an idempotent `session_shutdown` handler.

---

## Part 2 — Fallback/compat strategies for TUI-only extension UI

The question is what a browser host does when an extension calls `ctx.ui.custom()` (or `setEditorComponent`, `setFooter`, `setWidget` with a component factory). Four strategies, each with its failure mode.

### Current PI WEB position — and the honesty defect in it

`docs/plugins.md` § "Pi extension dialogs in PI WEB" states: PI WEB reports **`ctx.hasUI === true`**, implements `confirm`/`select`/`input` as inline transcript dialog cards with real answers, works from in-flight `tool_call` hooks, survives browser reloads (first answer wins), honors the extension's `timeout` plus a daemon `extensionDialogsTimeoutMs` safety valve, and settles open dialogs on abort/runtime replacement with the cancel value. Then:

> "Other UI surfaces are still no-ops. `ExtensionUIContext` methods beyond the three dialogs (widgets, status, editor, `custom`) remain unimplemented under PI WEB even though `hasUI` is `true`; do not rely on `hasUI` alone to detect them."

**Researcher inference (labeled):** this is exactly the shape AGENTS.md forbids under "Absence is not negation" — the host asserts a capability (`hasUI === true`) that is false for six of the nine methods pi defines as bridgeable, and the extension has no programmatic way to discover the truth. pi's own answer is `ctx.mode`: an extension is told to branch on `mode === "tui"`. PI WEB reporting `mode: "rpc"` while implementing only 3 of the 9 RPC-contract methods means an extension that correctly follows pi's documented guard still silently loses `notify`, `setStatus`, `setWidget`, `setTitle`, `setEditorText`. That is the first thing to fix, and it is cheap.

### Option A — Headless contract extraction

*Run the extension normally; render its already-declared data in native web widgets.*

This is what `appendEntry`/`sendMessage` + `setStatus`/`setWidget(string[])` already are: named, keyed, JSON or string-array payloads with no component in them. PI WEB already has the receiving seam — `MessageRendererContribution` in `src/plugin-api.ts` claims a `tag` and receives `{ sessionId, messageId, tag, payload, streaming, createdAt }`.

- **Cost:** none for the extension author; nothing new to learn.
- **Failure mode:** it covers only surfaces that *already* carry declared data. `ui.custom()` declares nothing — its contract is "here is a callback that owns the terminal and calls `done(value)`". There is nothing to extract. Attempting extraction by inspecting the returned component tree means PI WEB starts *interpreting* pi-tui internals, which are not a contract; a pi-tui refactor then breaks PI WEB silently. **Second failure mode:** if PI WEB asks extension authors to *also* declare a data form for their custom UI, that feature now has a TUI path and a web path — the two-producer shape AGENTS.md ("One feature moves whole or does not move") exists to prevent.

### Option B — Declarative UI schema bridge

*Define a JSON schema for UI; extensions target the schema; each host renders it natively.*

**The key finding: pi has already shipped this schema, and PI WEB should not invent a second one.** `docs/rpc.md` specifies `extension_ui_request` with `method` ∈ {select, confirm, input, editor, notify, setStatus, setWidget, setTitle, set_editor_text}, correlation `id`, and `extension_ui_response` with `value`/`confirmed`/`cancelled`. Field names are fixed (`options`, `title`, `message`, `placeholder`, `prefill`, `notifyType`, `statusKey`, `statusText`, `widgetKey`, `widgetLines`, `widgetPlacement`). It also states the limit explicitly: "Only string arrays are supported in RPC mode; component factories are ignored."

- **Cost:** PI WEB must own a rendering site for each method — and it has candidates already: `ComposerStatusLine` for `setStatus`, `DrawerSectionContribution` or a widget strip for `setWidget`, the existing notification surface for `notify`, `PluginHostUi.showDialog` for `editor`.
- **Failure mode:** schema drift. If PI WEB extends the schema with PI WEB-only methods, extensions written against PI WEB stop working in a terminal, and pi's schema becomes something PI WEB must track forever. **Mitigation and recommendation:** implement pi's nine exactly; contribute upstream rather than extend locally; never add a tenth method.
- **Second failure mode:** it still does not reach `custom()`. B is a ceiling, not a solution.

### Option C — Remote-component protocol

*Ship the rendered TUI to the browser — a component-tree diff, or an ANSI cell stream into an xterm surface.*

PI WEB already runs `@xterm/xterm` and `node-pty` (`package.json`), so the machinery exists.

- **Cost:** high, and it is the wrong kind of cost. `ui.custom()` "temporarily replaces the editor with your component"; the callback receives `tui` (screen dimensions, focus management) and `keybindings`, and drives `onKey`. To bridge it you must faithfully transport keyboard input, focus, terminal size, and the overlay/anchor/margin/percentage positioning model, and keep them consistent with the browser's own focus and modal law.
- **Failure mode (the disqualifying one):** the result is a terminal inside the app, and PI WEB's standing rules make that unusable — coarse-pointer 44px targets, 393×850 phone verification, `PluginHostUi.registerModal`/`showDialog` focus and Escape coordination, and the back gesture. A remoted TUI overlay obeys none of them. **Second failure mode:** two focus authorities (the app's modal layer and the remoted TUI) with no arbiter; the AGENTS.md "same symptom reported twice" rule then applies to every focus bug that follows.
- **Narrow legitimate use, labeled as inference:** if the owner ever wants pi extension TUI parity, the honest packaging is *the actual pi TUI in a terminal tab* — which PI WEB can already offer via its terminal panel — not a synthetic component bridge. That keeps one producer of TUI rendering (pi) instead of two.

### Option D — Degrade to text/JSON with an honest unsupported state

*Refuse the call, return the documented cancel value, and make the refusal visible and discoverable.*

pi already defines the exact degradation values (§1.6), including the cancel values PI WEB's docs confirm it honors: "`false` for confirm, `undefined` for select and input."

- **Cost:** an extension author must guard; pi already tells them to (`ctx.mode === "tui"`).
- **Failure mode:** *silent* degradation — precisely today's state, where `hasUI` says yes and `setStatus` does nothing. A silent no-op is indistinguishable from a bug in the extension. The fix is not to implement more, it is to *say* more: report `ctx.mode` honestly, surface an attributed diagnostic ("extension X called `ui.custom()`, unsupported in PI WEB") in the transcript or in Settings → PI WEB plugins next to the existing failed/incompatible/degraded states, and document the supported set in `docs/plugins.md` as a table rather than a sentence.

### Recommendation

**D as the floor, B for pi's nine, A for durable entries, never C.** Concretely, in priority order:

1. **Make absence honest** (smallest change, largest rule alignment). Either implement the six missing bridgeable methods, or stop claiming `hasUI === true` without a machine-readable capability report. Prefer: implement, then the claim becomes true.
2. **Implement `notify`, `setStatus`, `setWidget`, `setTitle`, `setEditorText`** against pi's exact RPC wire shapes, onto existing PI WEB surfaces. Note the *push* model this forces, which the repo's own design doc already flagged as the shape to converge on (`docs/design/plugin-architecture.md` → "Push, not pull"): pi extensions push named content; PI WEB's composer `status(context)` is pulled during render and needed a `requestUpdate` seam because of it.
3. **Route `appendEntry` custom entries into `MessageRendererContribution`.** The design doc records the asymmetry honestly: "a pi-web plugin can render a card it can never create … If a plugin should be able to write one, that producer belongs in the daemon half."
4. **Refuse `custom()` loudly**, with the plugin id, the method name, and a pointer to the terminal panel.

---

## Part 3 — What other hosts promise and refuse

**All of Part 3 is `[UNVERIFIED]` in this run** — no network access was available. URLs are canonical entry points for verification, not evidence that was fetched. **Support: researcher prior knowledge. Confidence: low-to-medium individually; the *pattern* across them is the useful part and is medium.**

1. **VS Code — webviews vs extension host.** `[UNVERIFIED]` — https://code.visualstudio.com/api/extension-guides/webview and https://code.visualstudio.com/api/advanced-topics/remote-extensions. The pattern to check: extension code runs in a Node extension host with no DOM; any custom UI must go in a webview (an iframe) communicating by `postMessage`; and `extensionKind` (`ui` vs `workspace`) declares where an extension may run in remote/SSH/Codespaces setups, with the host refusing to load an extension in the wrong location rather than degrading it. **Relevance:** `extensionKind` is the direct analogue of PI WEB's `machineSpecific`, and VS Code's promise is *placement declared in the manifest, enforced by the host* — not runtime discovery.
2. **Obsidian — desktop vs mobile.** `[UNVERIFIED]` — https://docs.obsidian.md/Reference/Manifest. The pattern to check: `isDesktopOnly: true` in `manifest.json`, which makes the plugin simply not appear on mobile. **Relevance:** this is the cheapest possible version of "honest absence": a manifest flag, checked before load, so a plugin that cannot work on a surface is *never activated there* instead of activating and silently failing. PI WEB has no equivalent field.
3. **Figma — plugin sandbox + iframe UI.** `[UNVERIFIED]` — https://www.figma.com/plugin-docs/. The pattern to check: plugin logic runs in a sandboxed JS realm with access to a document API but no DOM/network, and any UI runs in a separate iframe (`figma.showUI`) that talks to the sandbox by message passing; network access is declared in the manifest. **Relevance:** the strongest example of *capability declaration plus hard isolation*, and the clearest illustration of its cost — every UI interaction is asynchronous message passing.
4. **Zed — WASM extensions.** `[UNVERIFIED]` — https://zed.dev/docs/extensions/developing-extensions. The pattern to check: extensions compile to WebAssembly against a versioned host interface, and the host explicitly does **not** offer arbitrary UI rendering; extension categories (themes, languages, LSP adapters, slash commands) are enumerated. **Relevance:** the "refuse arbitrary UI, enumerate contribution categories" stance — which is also PI WEB's stance in `docs/plugins.md` ("Plugins do not get raw Fastify access, arbitrary routes, concrete core services, a generic event bus …").

**The transferable pattern (researcher inference, medium confidence):** every one of these hosts pairs (i) a manifest-declared *placement/capability* claim, checked before activation, with (ii) an *enumerated* contribution vocabulary, and refuses out-of-vocabulary requests. None of them tries to run a plugin authored for renderer A inside renderer B. The strategy PI WEB should copy is Obsidian's flag + Figma's declared capability, not any form of cross-renderer emulation.

---

## Part 4 — What PI WEB's plugin contract should look like

Evaluated against what `src/plugin-api.ts`, `src/server-plugin-api.ts`, `src/client/src/plugins/types.ts` and `docs/plugins.md` already say. **Support for all "today" columns: direct evidence from those files. Confidence: high.**

| Dimension | pi | PI WEB today | Recommendation |
|---|---|---|---|
| **Identity** | file path / package; `sourceInfo` is canonical provenance | `pluginId` (stable source id) + `runtimePluginId` (host-unique, may be machine-scoped); id regex `^[a-z][a-z0-9.-]*$`; `core`, `themes`, `machine.*` reserved | **Keep as-is; it is better than pi's.** Add a `sourceInfo`-equivalent (`source`, `scope`) to the *activation context*, not just the manifest — plugins currently cannot tell whether they were loaded bundled/local/user/project. |
| **Manifest** | `package.json` `pi` key, or convention directories | `package.json` `piWeb.plugins[]` with `{ id, browserRoot?, module?, serverModule?, machineSpecific? }`; exactly one supported shape, legacy shortcuts refused | **Keep.** The strictness (no `piWeb.plugin`, no string entries, no no-manifest fallback) is correct and should not be relaxed. |
| **Capability declaration** | none — an extension registers whatever it wants at runtime | **Missing.** Contributions are discovered by *calling* `activate()` and reading the returned object | **Add.** Declare contribution *kinds* in the manifest (`"contributes": ["actions","workspacePanels","messageRenderers"]`) so Settings → PI WEB plugins can show what a plugin will do before it runs, and so a host that does not implement a kind can refuse at discovery instead of dropping it silently. This is the Obsidian/Figma lesson. |
| **Versioned API** | implicit; the package is the version | Browser `apiVersion: 2` (hard break, "no v1 compatibility shim"), server `apiVersion: 1`, plus a `lifecycleVersion: 1` in the manifest and revision pairing for federated hosts | **Keep.** But finish the extraction of `@gang-of-beads/pi-web-plugin-api` — the design doc records the themes wave **blocked** on a type mismatch: internal `ThemeTokens` requires a closed union while published `ThemeTokens` is `Record<string,string>`, and published `QualifiedContributionId` is a plain string where the internal one is a `` `plugin:contribution` `` template, so a pack typed publicly is not assignable internally. Publish the union and the template type; do not cast. |
| **Contribution points** | tools, commands, shortcuts, flags, providers, event handlers, message/entry renderers, markdown transformer, resource paths | `src/plugin-api.ts` `PluginContributions`: `actions`, `navSections`, `machineSections`, `workspacePanels`, `workspaceLabels`, `themes`, `themePairs`, `composer`, `settingsSections`, `messageRenderers`, `drawerSections`. Server: `workspaceProvider`, `operations`, `routes`, `machineRegistry`, `agentFacts` | **Keep the vocabulary; fix the documentation gap** (see Contradictions). Add the missing mirror of pi's **entry producer**: today a plugin can claim a `tag` and render it but cannot create one. |
| **Permissions / trust** | project trust gate before `.pi/extensions` load; `project_trust` event; `trust.json`; "full system access" stated | Stated as trusted code, explicitly "a stability boundary rather than a security boundary"; `browserRoot` confines browser-public assets; safe-start levels (`bundled-only`, `none`) and offline `pi-web plugins disable` | **Keep the honesty.** Add the *project-trust gate* to project-local plugins when they land (below) — pi's rule copied verbatim, per the owner ruling already recorded in the design doc ("Project-local discovery is wanted, with pi's project-trust gate copied"). |
| **Per-project plugins** | `.pi/extensions/`, project-scoped packages, trust-gated | **Missing.** Discovery is bundled / `~/.pi-web/plugins` / installed Pi packages only. The manifest already has a `scope: "project"` value and `docs/plugins.md` says "Pi packages may be user or project scoped" | **Add `<project>/.pi-web/plugins/`, trust-gated**, matching pi and matching the AGENTS.md rule that project-local core config lives in `<project>/.pi-web/config.json`. Note the design doc lists project-local discovery as "to confirm". |
| **Machine-specific plugins** | n/a (pi is single-machine) | `machineSpecific` boolean; dual browser/server entries default `true` and **cannot** be `false`; contributions, file/terminal helpers and `backend.request()` are machine-scoped; remote themes ignored because themes are app-wide | **Keep.** This is genuinely ahead of every host in Part 3. Document the all-or-nothing mixed-version rollout behavior more prominently — it is currently a paragraph in `docs/plugins.md` and it is the thing that will bite an operator. |
| **Storage scoping** | session-derived (`appendEntry` + reconstruct on `session_start`), tool-result `details` for branch-correct state | Server: `ServerPluginStorage` with `directory`/`read`/`write`/`remove`, and the correct honesty note ("Missing is not empty … a corrupt document reads as undefined rather than throwing"). **Browser: none.** Browser plugins get `settings` (read-only, opaque) and `ui.query` (namespaced query-string) | **Add a browser-side per-plugin storage port** with the same absent-vs-empty contract, scoped by machine + project + workspace where applicable (AGENTS.md: "Data must carry the scope it belongs to"). Today a browser plugin needing persistence must reach for `localStorage`, which carries no scope key and survives machine switches — the exact defect class the standing rules name. |
| **Lifecycle** | factory (sync/async) → `session_start` → … → `session_shutdown`; "do not start background resources from the factory"; `/reload` | Browser: `activate()` once, "keep it cheap and synchronous", `dispose?()` on unregister, `on(kind, listener)` returning unsubscribers. Server: `activate` → `start` → `health` (inspected **once**, never polled) → `stop`, all with invocation-scoped `AbortSignal`s that "must not be retained as a plugin-lifetime shutdown signal"; snapshot resolved once per sessiond start; **never hot-reloaded** | **Keep.** Two additions: (a) an explicit `piWeb plugins reload` story for browser-only plugins beyond "hard reload the tab"; (b) copy pi's *stated* rule into `docs/plugins.md` — do not start background work in `activate()` — since PI WEB says "keep it cheap" but does not say why. |

### The mental-model rule

The design doc already states the goal — "mirror the Pi agent extension model rather than inventing a second mental model" — and the mapping table in `docs/design/plugin-architecture.md` is the right artifact. Three places where PI WEB currently diverges *without a recorded reason*, all from that same doc's own read of pi (**direct evidence — this is the repo's own analysis, quoted**):

1. **Push vs pull.** pi: `ctx.ui.setStatus(key, text)` / `setWidget(key, lines)` — the extension pushes when its state changes. PI WEB: `status(context)` is called by the host during render, which is why `requestUpdate` had to exist. The doc's verdict: "Aligning would remove one seam rather than add one."
2. **Durable entries have a producer.** pi pairs `registerEntryRenderer` with `appendEntry`. PI WEB has the renderer with no browser-side producer.
3. **Renderers get view state.** pi hands `(entry, { expanded }, theme)`. PI WEB hands a frozen view model with no `expanded`, "so a plugin card cannot offer a collapsed and an expanded form the way built-in tool results do."

---

## Part 5 — Security and isolation options for browser plugins

PI WEB today: direct ES-module import into the page, no sandbox, stated plainly ("Neither entry is sandboxed"). Options, with what each costs:

| Model | Isolation gained | Ergonomic cost against *this* codebase |
|---|---|---|
| **ES module import (today)** | none | zero cost. Plugins receive `html`/`svg` from the activation context, adopt `PluginHostUi.surfaceStyles`/`listStyles`/`workspacePanelStyles`, register with `registerModal`, and return `TemplateResult` from `render()`. Everything in `src/plugin-api.ts` assumes this. |
| **Shadow DOM only** | style containment; **no security boundary** | low. Note the live constraint already documented in the API: host styles must be adopted "per element instance in `createRenderRoot`: static styles freeze at module load, before the host is remembered." Worth doing for CSS hygiene; do not describe it as isolation. |
| **Web Worker** | script isolation, no DOM access | **breaks the contract entirely.** Every contribution in `PluginContributions` is a synchronous function returning a `TemplateResult`. A worker cannot produce one. You would need Option B's schema for *all* plugin UI, not just pi's nine — i.e., invent the second mental model the design explicitly rejects. |
| **iframe (`sandbox` + `postMessage`)** | true origin isolation (the Figma model) | **high, and it collides with named host features.** `registerModal` (document-wide modality, focus, `isTop`), `showDialog` (host owns focus/Escape/backdrop/back-gesture), the coarse-pointer breakpoint sharing, and the shared markdown/text stylesheets all assume same-document rendering. An iframe re-opens focus arbitration between two documents — the failure mode Part 3/Option C already identified. |

**Recommendation (with the trade-off named).** Keep trusted same-document modules; do **not** buy iframe isolation. The reason is not that isolation is worthless — it is that PI WEB's threat model already includes a *server* plugin running in-process in sessiond with the service user's full filesystem and environment, sharing sessiond's event loop, where "a CPU-bound, blocking, or deadlocked callback can stall sessions, terminals, and health endpoints." Sandboxing the browser half while the server half holds that power buys ergonomic cost and no real reduction in worst case. **What to buy instead, in order:**

1. **Keep narrowing capability, not code.** The current server API's refusal list (no Fastify, no routes, no service locator, no event bus, declared operations only, declared route templates only, host-owned `execFile` bounds) is the correct axis and is already working.
2. **Tighten `browserRoot` guidance to a rule.** The docs already warn that `browserRoot: "."` "makes almost the whole scanned package browser-public"; make a narrow root the documented default and diagnose `.` with a warning at discovery.
3. **Keep the two-tier recovery path** (`safe-start bundled-only` / `none`, offline disable) — it is the genuinely load-bearing safety feature and no host in Part 3 has a better one.
4. **State the boundary in one place.** It is currently correct but split between `docs/plugins.md` § Trust model and the server API docstrings.

---

## Part 6 — Concrete gaps against this repo

Read from `src/plugin-api.ts`, `src/server-plugin-api.ts`, `src/client/src/plugins/types.ts`, `docs/plugins.md`, `docs/design/plugin-architecture.md`. **Support: direct evidence. Confidence: high.**

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| G1 | **`docs/plugins.md` documents 3 contribution arrays; the shipped API has 11.** The doc's `PluginContributions` block lists only `actions`, `workspacePanels`, `workspaceLabels`. `src/plugin-api.ts` ships those plus `navSections`, `machineSections`, `themes`, `themePairs`, `composer`, `settingsSections`, `messageRenderers`, `drawerSections`. | both files | A plugin author following the published docs cannot discover 8 of 11 contribution points. The doc is also the URL the copy-paste AI prompts point at. |
| G2 | **`docs/plugins.md` says a server activation may return only `workspaceProvider`/`start`/`stop`/`health`.** `src/server-plugin-api.ts` also ships `operations`, `routes`, `machineRegistry`, `agentFacts`, plus context `storage`, `ports` (`workspaceCatalog`, `piWebConfig`, `machinesStorePath`, `localRuntime`, `machineRegistry`). | both files | Same as G1 on the server side; `callOperation` exists in the browser context with no documented server counterpart in the public doc. |
| G3 | **No browser-plugin storage.** Server has `ServerPluginStorage`; browser has `settings` (read-only) + `ui.query` only. | `src/plugin-api.ts`, `src/server-plugin-api.ts` | Browser plugins reach for unscoped `localStorage`; violates "Data must carry the scope it belongs to". |
| G4 | **No project-local plugin discovery.** Discovery = bundled, `~/.pi-web/plugins`, installed Pi packages. Manifest already emits `scope: "project"`. | `docs/plugins.md` § Discovery and packaging | Diverges from pi (`.pi/extensions/`) and from the owner ruling recorded in the design doc; the trust gate that would accompany it is also absent. |
| G5 | **`hasUI === true` while 6 of pi's 9 bridgeable UI methods are no-ops.** | `docs/plugins.md` § "Other UI surfaces are still no-ops" vs `docs/rpc.md` § Extension UI Protocol | Extensions that follow pi's documented guard still fail silently. Directly violates "Absence is not negation". |
| G6 | **Message renderers have no producer and no `expanded` state.** pi pairs `appendEntry` with `registerEntryRenderer` and passes `{ expanded }`. | `src/plugin-api.ts` `MessageRendererViewModel`; design doc's own analysis | Plugin cards cannot offer collapsed/expanded forms like built-in tool results, and cannot create the entries they render. |
| G7 | **Composer status is pull-based**, requiring `requestUpdate`, where pi's equivalent is push (`setStatus`/`setWidget`). | `src/plugin-api.ts` `ComposerContribution.status(context)`; design doc § "Push, not pull" | An extra seam exists that would not exist under pi's model; converging later gets harder as more surfaces copy the pull pattern. |
| G8 | **Plugin API package not published; themes wave blocked on a type mismatch** (internal closed-union `ThemeTokens` and template-literal `QualifiedContributionId` vs published `Record<string,string>`/`string`). | design doc § "Themes wave"; `package.json` exposes `./plugin-api` as **types-only** | Split plugin repos cannot build against a version; the doc's own rule ("pi-web remains the source") is a stopgap that cannot be lifted until this publishes. |
| G9 | **No capability/contribution declaration in the manifest.** Entries declare `id`/`module`/`serverModule`/`browserRoot`/`machineSpecific` only. | `docs/plugins.md` | Settings → PI WEB plugins cannot show what a plugin *will* contribute before activation; no Obsidian-style pre-load refusal for a plugin whose kinds this host does not implement. |
| G10 | **Server plugin `health()` is inspected once and never polled** — correct and documented, but the browser has no way to *see* a provider that degraded after startup. | `docs/plugins.md`: "that inspection is not polled again during the process lifetime" | A degraded-after-start backend is indistinguishable from a healthy one at the UI. Honest-absence risk. |
| G11 | **Goals wave: core still holds a plugin's state.** `goalsLoad` in core state, refresh controller in core, two render sites; the daemon hardcodes goal tool names and the continuation marker (`injectedTurnKinds.ts:41-43`, `pluginSurfaces.ts:31` per the design doc's scan). | design doc §§ scan results, goals panel | Named as the last blocker of that wave; `ServerPluginAgentFacts` exists in the API as the intended replacement for those core constants but the goals plugin has not moved onto it. |

---

## Contradictions

1. **Public docs vs shipped contract (G1/G2).** `docs/plugins.md` and `src/plugin-api.ts`/`src/server-plugin-api.ts` disagree on how many contribution points exist and what a server activation may return. Both were read directly; the code is newer. Not silently resolved here — this needs an owner decision on whether the extra points are *intentionally undocumented because unstable*, or simply undocumented.
2. **`hasUI` semantics (G5).** pi's `docs/rpc.md` defines `hasUI === true` to mean "dialog **and fire-and-forget** methods are functional via the extension UI sub-protocol". PI WEB's `docs/plugins.md` sets `hasUI === true` while stating the fire-and-forget methods are no-ops. Both statements were read directly; they contradict each other about what the flag means.
3. **Design-doc extraction table vs shipped code.** The design doc's gap matrix marks message renderers, composer contributions, settings sections and client lifecycle events as `MISSING`; all four are present in `src/plugin-api.ts` today. **Interpretation, not evidence:** the doc's matrix is dated `2026-09-04` and the code has moved past it; the doc's later sections (terminal/themes/goals waves) are consistent with that. Someone should date-stamp or prune the stale matrix.

## Missing evidence

- **All of Part 3 is unverified.** No network access this run. The VS Code `extensionKind`, Obsidian `isDesktopOnly`, Figma sandbox/iframe split, and Zed WASM claims are prior knowledge with canonical URLs supplied; none was fetched or `source_check`ed. Do not cite them in a design doc without verification.
- **`/nix/store/*/node_modules/@earendil-works/pi-coding-agent/`** could not be enumerated (no glob/shell). The docs read here came from the project-local `node_modules` copy at `@earendil-works/pi-coding-agent ^0.85.0`. If the nix-store copy is a different version, the extension surface could differ. Unverified whether they match.
- **`docs/extensions.md` lines 2232–3024 were read; `examples/extensions/` was not opened** (no directory listing tool). The examples table in the doc names them, so the *inventory* is evidence but the *implementations* are not.
- **`docs/custom-tools.md` does not exist** in this package (`ENOENT` at `node_modules/@earendil-works/pi-coding-agent/docs/custom-tools.md`). Custom-tool documentation lives inside `docs/extensions.md` § Custom Tools; the task's premise that a separate file exists is not true for version 0.85.
- **`docs/tui.md`, `docs/themes.md`, `docs/packages.md`, `docs/settings.md`** were not read; component API details, theme token names, and package-manifest edge cases are therefore secondhand from `extensions.md` cross-references.
- **Not verified by reading source:** how PI WEB's daemon currently implements the three extension dialogs (the claim comes from `docs/plugins.md`, not from `src/server/daemon/**`). If the exact wire shape matters for extending to the other six methods, read the daemon implementation before designing.

## Sources

**Kept (primary, read directly on this machine):**
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` — the authoritative statement of what a Pi extension can contribute: events, `ExtensionAPI` methods, tools, custom UI, mode behavior, examples inventory.
- `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` — the decisive source for Part 2: `extension_ui_request`/`extension_ui_response`, the nine bridgeable methods, and pi's own explicit degradation list for TUI-only methods.
- `node_modules/@earendil-works/pi-coding-agent/README.md` — extension locations, project trust flow, package model, `/reload`, security posture, mode flags.
- `src/plugin-api.ts` — the shipped browser contract (11 contribution kinds, `PluginActivationContext`, `PluginHostUi`, lifecycle events).
- `src/server-plugin-api.ts` — the shipped server contract (`operations`, `routes`, `storage`, `ports`, `WorkspaceProvider`, `MachineRegistryContribution`, `ServerPluginAgentFacts`).
- `src/client/src/plugins/types.ts` — the internal mirror, including `Qualified*` shapes, `PiWebUnstableRuntimeContext`, and the docstrings explaining *why* each seam exists.
- `docs/plugins.md` — the published plugin contract, discovery/packaging rules, manifest shape, trust model, federation semantics, safe-start recovery.
- `docs/design/plugin-architecture.md` — owner rulings, the pi→PI WEB mapping table, the scan gap matrix, and the wave-by-wave blockers (terminal seams, themes type mismatch, goals data path).
- `package.json` — pins `@earendil-works/pi-coding-agent ^0.85.0` (dev) / `>=0.84.0` (peer); confirms `./plugin-api` is exported **types-only** while `./server-plugin-api` also ships JS.

**Rejected / deprioritized:**
- `node_modules/.../docs/custom-tools.md` — does not exist at this version; superseded by `extensions.md` § Custom Tools.
- Content-farm / blog summaries of VS Code, Obsidian, Figma, Zed plugin models — not reachable this run, and would be weak evidence anyway; the canonical docs URLs are listed instead so verification goes straight to primary.

## Next steps

1. **Verify Part 3 against the four canonical doc URLs** before any of it enters a design document. The single highest-value check is Obsidian's `isDesktopOnly` manifest flag and VS Code's `extensionKind`, because they are the direct precedents for the recommended manifest capability declaration (G9).
2. **Read `src/server/daemon/**` for the existing extension-dialog implementation** to size the work of adding `notify`/`setStatus`/`setWidget`/`setTitle`/`setEditorText` against pi's exact RPC shapes — this is the concrete next design task and the only one that closes G5.
3. **Confirm the nix-store `pi-coding-agent` version matches 0.85** so the extension surface documented here is the one PI WEB actually runs against.
