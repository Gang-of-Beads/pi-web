# PI WEB plugin API reference

This page is the complete contract between PI WEB and a plugin: package metadata, the browser entry (API v2), the server entry (API v1), every contribution, context member, limit and error. For a walkthrough, start with the [plugin authoring guide](plugin-authoring.md); for the rules a published plugin follows, see [plugin conventions](plugin-conventions.md). Installing and operating plugins is covered in [PI WEB plugins](plugins.md).

The TypeScript declarations are the source of truth for shapes: `@gang-of-beads/pi-web/plugin-api` (browser) and `@gang-of-beads/pi-web/server-plugin-api` (server). This page says what the host does with them.

> **Host-internal, unstable: may change without notice.** Members marked this way exist in the published declarations because PI WEB's own bundled plugins (Workspaces, Machines, Updates) use them. They are not part of the plugin contract. A third-party plugin that uses one must expect it to change shape or disappear in any release.

## Contents

- [Packages and entrypoints](#packages-and-entrypoints)
- [Versions and compatibility](#versions-and-compatibility)
- [Package metadata](#package-metadata)
- [Browser entry](#browser-entry)
- [Contributions](#contributions)
- [Contexts](#contexts)
- [Host UI](#host-ui)
- [Workspace helpers](#workspace-helpers)
- [Server entry](#server-entry)
- [Workspace provider contract](#workspace-provider-contract)
- [Lifecycle guarantees](#lifecycle-guarantees)
- [Limits](#limits)
- [Errors and status codes](#errors-and-status-codes)
- [Manifest and browser assets](#manifest-and-browser-assets)

## Packages and entrypoints

The declarations ship in the PI WEB npm package. Depend on it as a development dependency only; a plugin bundles what it imports at runtime and never imports PI WEB at runtime from the host.

```json
{ "devDependencies": { "@gang-of-beads/pi-web": "^2.202610.5" } }
```

`@gang-of-beads/pi-web` depends on `node-pty`, a native module a plugin does not need. Install with scripts disabled (`npm install --ignore-scripts`, or `ignore-scripts=true` in the plugin's `.npmrc`). A lightweight package, `@gang-of-beads/pi-web-plugin-api`, is published as an alpha (`npm install --save-dev @gang-of-beads/pi-web-plugin-api@alpha`) with the same declarations and public runtime helpers and without `node-pty`. The reference plugins still depend on `@gang-of-beads/pi-web` as above. See the [standalone package README](https://github.com/Gang-of-Beads/pi-web/blob/main/packages/pi-web-plugin-api/README.md) for its browser dependency, bundling and compatibility requirements.

| Entrypoint | For | Runtime values it exports |
|---|---|---|
| `@gang-of-beads/pi-web/plugin-api` | browser entries | `CORE_STATUS_FLAGS` (the status-flag ids PI WEB publishes: `core:working`, `core:terminal`, `core:unread`), `workspaceFileRefusalOf(error)` |
| `@gang-of-beads/pi-web/server-plugin-api` | server entries | `parsePiWebRuntimeResponse`, `SESSION_TRANSCRIPTS_NOT_READY`, `DEFAULT_REMOTE_REQUEST_TIMEOUT_MS`, `DEFAULT_REMOTE_HEALTH_TIMEOUT_MS`, `RemoteMachineRequestError` |

Import types with `import type`. If you import one of the runtime values, your bundler inlines it; the page has no import map. Deep imports (`@gang-of-beads/pi-web/dist/...`, `.../src/...`) and any other subpath are not part of the contract.

## Versions and compatibility

| Version | Value | Meaning |
|---|---|---|
| Browser API | `apiVersion: 2` | The default export of a browser module. Any other value is refused with the expected version. Browser API v1 was removed without a shim. |
| Server API | `apiVersion: 1` | The default export of a server module. |
| Plugin lifecycle | `lifecycleVersion: 1` | The browser manifest's version. A gateway refuses a remote manifest whose lifecycle it does not support. |

Within these versions the contract grows by adding optional members. A plugin stays compatible with older hosts by feature detection:

- Optional context members (`on`, `callOperation`, `ui`, `ui.confirm`, `ui.renderList`, `ui.readFailure`, `host.workspacePanelFullscreenAvailable` and others marked optional) are absent on hosts older than the member. Check before calling, and degrade with a sentence the reader can act on ("This page needs a newer PI WEB").
- A browser contribution kind the host does not know is ignored.
- A server activation field the host does not know is ignored and logged: "server plugin activation carries an unknown field; the running host does not implement it".
- A `piWeb.plugins[]` field the host does not know is ignored.

The repository keeps a declaration baseline (`test-fixtures/plugin-api-baseline/`); a change to the published declarations shows up there and is reviewed as a contract change.

## Package metadata

A package declares its plugins in `package.json`:

```json
{
  "name": "@your-scope/pi-web-example",
  "type": "module",
  "piWeb": {
    "plugins": [
      {
        "id": "example",
        "browserRoot": "dist/browser",
        "module": "dist/browser/pi-web-plugin.js",
        "serverModule": "dist/server-plugin.js"
      }
    ]
  }
}
```

| Field | Type | Default | Rule |
|---|---|---|---|
| `id` | string | required | Matches `^[a-z][a-z0-9.-]*$`. `core` and every id starting with `machine.` are reserved. One package owns an id; see [discovery order](plugins.md#where-pi-web-finds-plugins). |
| `module` | string | none | The browser entry, a package-relative path inside `browserRoot`. |
| `browserRoot` | string | none | Required with `module`, refused without it. `.` or a package-relative directory; every file under it is browser-public. |
| `serverModule` | string | none | The server entry, a package-relative path. Imported as a Node ES module: declare `"type": "module"` for a `.js` file, or use `.mjs`. |
| `machineSpecific` | boolean | `true` when both `module` and `serverModule` are set, else `false` | See [machine-specific plugins](#machine-specific-plugins). |
| `runs` | `"daemon"`, `"web"` or `"both"` | `"daemon"` | **Host-internal, unstable.** Which process activates the server entry. `"web"` and `"both"` require `serverModule`. |
| `hostFacts` | `["dockerMode"]` | none | **Host-internal, unstable.** Host facts appended to the browser module's URL query. |

Each entry needs at least one of `module` and `serverModule`. Module paths and `browserRoot` must be safe canonical relative paths to existing files and directories inside the package: no backslashes, no absolute or drive-qualified paths, and no empty, `.`, `..`, `.git` or `node_modules` segments (`browserRoot` may be exactly `.`). The browser module must stay inside `browserRoot` both as written and after resolving symlinks, and the browser paths must match the directory entries exactly, including case.

`piWeb.plugin` (singular), string entries, `piWeb.id` and packages without `package.json` are refused. `piWeb.title` belongs to Pi extension packages ([the extension's name](pi-extensions.md#the-extensions-name-in-pi-web)). `piWeb.vendorBundles` is read only by PI WEB's own build for its bundled plugins.

A plugin's settings live in the PI WEB config under `plugins.<id>.settings` and must be JSON. Both halves receive them (see the contexts below); the browser manifest carries them to every page that opens PI WEB, so never put a secret there that the browser must not see.

### Package size

Discovery hashes the whole package, without entering `.git` or `node_modules`, into one revision. A package is refused when the scan exceeds **4,096 directory entries** or **16 MiB** of file content, including files outside `browserRoot`. Keep caches and unrelated artifacts out of the installed package.

### Machine-specific plugins

With several machines, a page can load the same plugin id from this server (the gateway) and from the selected remote machine.

- `machineSpecific: false`: the gateway's copy serves every machine, and a remote machine's copy of the same id is not loaded.
- `machineSpecific: true`: the gateway's copy appears only for the local machine, and each remote machine uses its own copy.

A dual entry defaults to `true`. It may set `false` when its browser half works against any machine's backend, as the bundled Machines plugin does.

A remote machine's copy is imported into the same page as the gateway's copy, so:

- define custom elements only when the name is free: `if (!customElements.get(tag)) customElements.define(tag, Element)`. Do not use Lit's `@customElement` decorator; a second, unguarded define throws and that copy fails to load;
- the second copy reuses the class defined first, which may be another version of your plugin. Pass everything that belongs to a machine (data, callbacks, `callOperation`) to the element through properties from `render`, give every property a default, and keep nothing per machine in module-level or static state.

## Browser entry

```ts
import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Example",
  activate: ({ pluginId, runtimePluginId, html }) => ({
    contributions: {
      actions: [{
        id: "workspace.open",
        title: "Open Example",
        run: ({ selectWorkspaceTool }) => { selectWorkspaceTool(`${runtimePluginId}:workspace.example`); },
      }],
      workspacePanels: [{
        id: "workspace.example",
        title: "Example",
        visible: ({ workspace }) => workspace.provider?.pluginId === pluginId,
        render: ({ workspace }) => html`<p>${workspace.label}</p>`,
      }],
    },
    dispose: () => { /* stop timers, sockets and listeners started here */ },
  }),
};

export default plugin;
```

The module's default export has `apiVersion: 2`, a non-empty `name` and `activate(context)`. `activate` runs when a page loads the plugin and again each time it is turned back on while the page is open. It is synchronous: return the contributions and start expensive or asynchronous work from callbacks, custom elements or user actions. `dispose`, if returned, runs when the plugin is turned off or its machine stops listing it; see [lifecycle guarantees](#lifecycle-guarantees).

### Activation context

`activate` receives a frozen `PluginActivationContext`:

| Member | Description |
|---|---|
| `apiVersion` | `2`. |
| `pluginId` | The stable package id, the same locally and through federation. Compare it with `workspace.provider.pluginId` to recognise your own workspaces. |
| `runtimePluginId` | The id the host registered this copy under; a remote machine's copy may be machine-scoped. Use it to build qualified contribution ids such as `${runtimePluginId}:workspace.example`. |
| `html`, `svg` | Lit template tags bound to the host's Lit. |
| `settings` | The plugin's `plugins.<id>.settings` block, or `undefined` when it has none (which is not the same as configured empty). |
| `on(kind, listener)` | Subscribe to a [lifecycle event](#lifecycle-events); returns the unsubscribe function. Optional. |
| `callOperation(name, input)` | Call one of this plugin's own [server operations](#operations) on the machine this copy belongs to; resolves with its JSON result, rejects with the server's error. Optional. |
| `ui` | [Host UI](#host-ui) helpers. Optional. |
| `openPage(pageId)` | Show a page by its qualified id, as Go to does (for example `${runtimePluginId}:global.example`). Optional. |
| `readPiWebStatus()` | **Host-internal, unstable.** The PI WEB status of the machine this copy belongs to. |
| `fetchJson(path, init)` | **Host-internal, unstable.** Calls a PI WEB JSON endpoint by its application path. Use `callOperation` for your own server half. |

### Lifecycle events

| Kind | Payload | When |
|---|---|---|
| `session-selected` | `sessionId`, `machineId` | A session was selected. |
| `session-left` | `sessionId` | The selected session was left. |
| `connection-changed` | `connected` | The page's connection to the server dropped or came back. |
| `theme-applied` | `themeId` | A theme was applied. |
| `session-activity-settled` | `sessionId`, `machineId` | The selected session's turn ended, or its last background run ended while no turn runs: what a page shows may have changed. |
| `settings-changed` | `settings` | The plugin's settings changed. A browser-only plugin hears it as soon as the change is saved through Settings or the config API; a plugin with a server half is withheld from the page until the session daemon restarts with the new settings. |

Listeners are dropped with the plugin whether or not `dispose` removes them.

### Contribution ids

Every contribution has a local `id` matching `^[a-z][a-z0-9.-]*$`, unique within the plugin. The host qualifies it as `<runtimePluginId>:<id>`; that qualified id is what `selectWorkspaceTool`, `openPage`, `refreshWorkspacePanels`, shortcut preferences and route aliases use. An invalid or duplicate id fails the plugin's registration ("Invalid contribution id", "Duplicate contribution id").

## Contributions

`activate` returns `{ contributions }`, an object with any of these arrays:

| Kind | Adds |
|---|---|
| [`actions`](#actions) | Entries in the action palette, with optional shortcuts. |
| [`workspacePanels`](#workspace-panels) | Pages of a project, listed in Go to. |
| [`globalPanels`](#global-pages) | Pages about the machine on screen, needing no project. |
| [`workspaceLabels`](#workspace-labels) | Short inline items beside each workspace in the workspace list. |
| [`sessionSections`](#session-sections) | Sections in every list of sessions. |
| [`activityNotes`](#activity-notes) | A short line beside a session's activity state. |
| [`composer`](#composer-controls) | Controls in the message composer. |
| [`settingsSections`](#settings-sections) | Sections in the Settings dialog. |
| [`themes`, `themePairs`](#themes-and-theme-pairs) | Themes and light/dark pairs. |
| [`messageRenderers`](#message-renderers) | The drawing of custom transcript rows of one type. |
| [`toolRenderers`](#tool-renderers) | The drawing of one tool's calls in the transcript. |
| [`codeFenceRenderers`](#code-fence-renderers) | The drawing of one fenced code language. |
| [`navSections`](#navigation-sections) | **Host-internal, unstable.** The project and workspace lists. |

Contributions are scoped to their machine: a remote machine's contributions appear only while that machine is selected. `drawerSections` was removed; returning it fails registration.

### Actions

Actions appear in the action palette and can carry a keyboard shortcut.

```ts
interface PluginAction {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  shortcutAliases?: QualifiedContributionId[];
  group?: string;
  enabled?: (context: PluginRuntimeContext) => boolean;
  disabledReason?: (context: PluginRuntimeContext) => string | undefined;
  run: (context: PluginRuntimeContext) => void | Promise<void>;
}
```

- `enabled` is evaluated when the palette asks for actions. A disabled action with a `disabledReason` stays visible with that explanation.
- `run` receives the [runtime context](#runtime-context).
- `shortcut` is a default. The reader can rebind or clear it in **Settings → Keyboard**, where their key wins. A shortcut must start with Ctrl/⌘ (`mod`) or Alt; plain keys are refused so typing is never captured. Sequences are allowed, such as `mod+g p`. Avoid keys PI WEB uses (`mod+shift+p` opens the action palette). A keybinding needs an action: there are no standalone plugin key handlers.
- `shortcutAliases` lists former qualified action ids whose saved shortcut preference should still apply to this action.
- **Host-internal, unstable:** PI WEB runs the active action with local id `add-project` from its Add project buttons, and the one with id `add-machine` from Add machine; the bundled Workspaces and Machines plugins contribute them.

### Workspace panels

A workspace panel is a page of a project, listed in Go to; on a desktop it fills the right-hand column.

```ts
interface WorkspacePanelContribution {
  id: string;
  title: string;
  icon?: TemplateResult;
  order?: number;
  routeAliases?: string[];
  visible?: (context: WorkspacePanelContext) => boolean;
  fronts?: string;
  badge?: (context: WorkspacePanelContext) => string | number | TemplateResult | undefined;
  onInvalidate?: (context: WorkspacePanelContext) => void | Promise<void>;
  toolbar?: (context: WorkspacePanelContext) => TemplateResult;
  fullscreen?: boolean;
  render: (context: WorkspacePanelContext) => TemplateResult;
}
```

- `icon` is drawn in compact tab bars. Use an SVG from the `svg` tag with `currentColor` so themes apply; without one the title's initials are used.
- `toolbar` draws the page's controls at the top, always visible; `render` draws everything below. PI WEB draws no title row (the app bar names the page), so a page says its own status in its toolbar or content. `summary` is still accepted so older plugins type-check, but is not drawn.
- `visible` hides the page for a workspace it does not apply to. `badge` puts a short count or mark on its entry.
- `fronts` names the agent-side surface the page stands for, as the plugin's server half declares it in [`agentFacts.surfaces`](#agent-facts). Go to leaves the page out while the session on screen reports that surface absent, and keeps it when the surface failed to load or nothing is known yet.
- `onInvalidate` runs when an action or the host calls `refreshWorkspacePanels()` for this page; refresh the page's data there and call `host.requestRender()`.
- `routeAliases` are other names that open this page: former URL values, and host slots such as `core:global.terminal`.
- `fullscreen: true` lets the page take the whole app canvas on a wide window. PI WEB draws no control for it: draw an enter control while `host.workspacePanelFullscreenAvailable?.()` is true that calls `host.setWorkspacePanelFullscreen(true)`, and an exit control while `host.workspacePanelFullscreen()` is true. PI WEB ignores the request from a page that did not declare `fullscreen`, gives the canvas back when the reader opens another page, Chat or Sessions, and keeps the request while the window is too narrow. Hosts older than `workspacePanelFullscreenAvailable` lack it: offer no enter control there.

What `toolbar` and `render` return is drawn inside the host's panel, which carries the panel styles: classes such as `toolbar`, `viewer`, `empty-state` and `muted` apply to it. Inside your own element's shadow root those styles do not reach; adopt `ui.workspacePanelStyles` there (see [Host UI](#host-ui)).

### Global pages

A global page is about the machine on screen and needs no project. Contribute it under `globalPanels`; a plugin may bring both kinds.

```ts
interface GlobalPanelContribution {
  id: string;
  title: string;
  icon?: TemplateResult;
  order?: number;
  routeAliases?: string[];
  visible?: (context: GlobalPanelContext) => boolean;
  fronts?: string;
  badge?: (context: GlobalPanelContext) => string | number | TemplateResult | undefined;
  toolbar?: (context: GlobalPanelContext) => TemplateResult;
  render: (context: GlobalPanelContext) => TemplateResult;
}
```

Go to lists the pages of the scope the reader is looking at. On the Navigate page its switch decides: a project offers that project's pages, `All projects` offers the global pages. Elsewhere Go to follows what is open: a project's session or page offers its project pages; nothing open, or a global page, offers the global pages. In a project's scope a global page also appears when its plugin brings no project page. Global pages are never drawn on the whole canvas. The [global page context](#global-page-context) has no workspace, files or prompt, so a global page cannot reach a project by accident.

### Workspace labels

Workspace labels add short inline items beside each workspace in the workspace list: an environment, a local URL, a health state.

```ts
interface WorkspaceLabelContribution {
  id: string;
  order?: number;
  visible?: (context: WorkspaceLabelContext) => boolean;
  items: (context: WorkspaceLabelContext) => WorkspaceLabelItem[];
}

type WorkspaceLabelItem =
  | { type: "text"; text: string; title?: string }
  | { type: "link"; text: string; href: string; title?: string; target?: "_blank" | "_self" }
  | { type: "render"; render: () => TemplateResult };
```

`items` is synchronous: return cached items (or `[]` for nothing), start any read from the callback, and call `host.requestRender()` when the cache changes. Items are sorted by `order`, then id. PI WEB adds `rel="noopener noreferrer"` to `_blank` links and draws `javascript:` and `data:` links as plain text. A `render` item draws custom inline UI, typically a custom element that owns its own loading.

```js
const cache = new Map();

function devUrl(context) {
  const key = `${context.machine.id}:${context.workspace.id}`;
  if (!cache.has(key)) {
    cache.set(key, { read: "reading" });
    context.files.readFile(".env.local").then(
      (file) => { cache.set(key, { read: "ready", url: file.content.match(/^DEV_URL=(.+)$/m)?.[1] }); context.host.requestRender(); },
      () => { cache.set(key, { read: "failed" }); context.host.requestRender(); },
    );
  }
  return cache.get(key);
}

workspaceLabels: [{
  id: "dev-url",
  items: (context) => {
    const known = devUrl(context);
    return known.url === undefined ? [] : [{ type: "link", text: known.url, href: known.url, target: "_blank" }];
  },
}]
```

### Session sections

Every list of sessions (the Navigate page, the session search) is built from sections. PI WEB's are Pinned (`order` 100), Active (500) and Archived (900).

```ts
interface SessionSectionContribution {
  id: string;
  title: string;
  order: number;
  foldedByDefault?: boolean;
  claims: (subject: { sessionId: string; machineId: string; cwd: string; name: string | undefined; pinned: boolean; archived: boolean }) => boolean;
}
```

A session lands in the first section, by `order`, whose `claims` returns true; a claim that throws claims nothing. Inside a section the host orders sessions by what they need from the reader (failed, asking, unread, running, the rest), then by last activity. Sections fold, and the host remembers each list's folds on the device; `foldedByDefault` starts a section folded.

### Activity notes

An activity note is a short line beside a session's own activity state, for work the session's turn does not cover (a background run still going).

```ts
interface ActivityNoteContribution {
  id: string;
  order?: number;
  note: (context: { sessionId: string; machineId: string; sessionCwd: string | undefined; status: unknown; idle: boolean }) => string | undefined;
}
```

Return `undefined` for no note. `idle` says whether the assistant's own turn is idle; `status` is the session's status frame, to be read defensively.

### Composer controls

```ts
interface ComposerContribution {
  id: string;
  slot: "leading" | "trailing";
  title: string;
  icon?: TemplateResult;
  order?: number;
  available?: (context: ComposerRuntimeContext) => boolean;
  enabled?: (context: ComposerRuntimeContext) => boolean;
  disabledReason?: (context: ComposerRuntimeContext) => string | undefined;
  status?: (context: ComposerRuntimeContext) => { text: string; severity: "info" | "problem" } | undefined;
  run: (context: ComposerRuntimeContext) => void | Promise<void>;
}
```

- `available: false` removes the control: use it for a capability the machine lacks. `enabled: false` greys it out: use it for "not right now", with a `disabledReason`.
- `status` is a status line the composer shows for the control (a dictation in progress, or why it stopped).
- The context carries `sessionId`, `machineId`, `draft`, `busy`, and `insertText`, `replaceDraft`, `notify(message, severity)` and `requestUpdate()`.

### Settings sections

```ts
interface SettingsSectionContribution {
  id: string;
  title: string;
  order?: number;
  render: (context: PluginRuntimeContext) => TemplateResult;
}
```

A section of the Settings dialog, for the selected machine's copy of the plugin, ordered by `order` (default 1000), then title.

### Themes and theme pairs

```ts
interface ThemeContribution {
  id: string;
  replacedBy?: string;
  name: string;
  description?: string;
  order?: number;
  colorScheme: "dark" | "light";
  tokens: ThemeTokens;
}

interface ThemePairContribution {
  id: string;
  name: string;
  description?: string;
  order?: number;
  light: string;
  dark: string;
}
```

Themes appear in **Settings → Appearance**. `tokens` sets every `LegacyThemeToken` (the CSS custom properties `--pi-bg`, `--pi-surface`, `--pi-text`, `--pi-accent` and the rest of the type) and may set the surface ladder (`--pi-surface-canvas`, `-panel`, `-card`, `-raised`, `-active`, derived from the legacy tokens when absent) and `--pi-on-accent`. A theme pair names a light and a dark theme of the same plugin by local id; the reader can let the system's preference choose between them. `replacedBy` names another theme by qualified id (`core:material-dark`, `core:material-light` or `<plugin>:<theme>`): when that theme exists and declares no `replacedBy` of its own, Settings hides this entry and a saved choice of it moves to the target. Otherwise the entry stays selectable with its own tokens, so hosts that predate the field keep working. A `replacedBy` that is not a qualified id fails the plugin's registration, like an invalid theme id. Themes from a remote machine are ignored, because a theme applies to the whole app.

### Message renderers

A message renderer claims one custom payload type in the transcript: the custom messages an extension sends with that type and the custom entries it records with it.

```ts
interface MessageRendererContribution {
  id: string;
  tag: string;
  render: (view: MessageRendererViewModel) => TemplateResult;
}
```

The view carries `sessionId`, `messageId`, `tag`, `payload` (the extension's data; read it defensively), `streaming` and `createdAt`, and optionally:

- `kind`: `"message"` or `"entry"`;
- `drawn`: the lines the extension's own Pi renderer draws for the row, when one is available;
- `followingUserTexts`: the reader's later messages in the loaded transcript, oldest first, so a card can tell it was answered;
- `followingRows`: the later custom rows (`tag`, `kind`, `payload`), so a card can tell what became of what it shows;
- `insertIntoComposer(text)`: put text in the composer for the reader to edit and send;
- `sendMessage(text)`: send text to the session as the reader, exactly as typing it would.

The host draws the card chrome around `render`'s output. An unclaimed type is drawn by the extension's own renderer or as Pi's default. One plugin claims a tag per machine; a second claim fails registration ("Message tag … is already rendered by …").

### Tool renderers

```ts
interface ToolRendererContribution {
  id: string;
  toolName: string;
  render: (view: { toolName: string; status: "running" | "success" | "error" | "interrupted"; args: unknown; details: unknown; resultText: string | undefined }) => TemplateResult | undefined;
}
```

A tool renderer draws one tool's calls in the transcript, claiming the tool by the name the agent calls it. `details` is what the tool's last update or its result carried, so the drawing follows the call live; read it defensively. `interrupted` is a call the turn left unfinished. Return `undefined` for a call you cannot draw yet, and the host's tool card draws it; a `render` that throws does the same and is logged, so a tool row is never empty. One plugin claims a tool name per machine; a second claim fails registration. [pi-web-workflows](https://github.com/Gang-of-Beads/pi-web-workflows) draws the pi-dynamic-workflows `workflow` tool this way.

### Code-fence renderers

```ts
interface CodeFenceRendererContribution {
  id: string;
  language: string;
  render: (source: string) => Node | Promise<Node>;
}
```

Claims one fenced code language (matched lowercase). Once a code block has settled, `render` receives the fence's source and returns a DOM node drawn in the block's place; the source block stays underneath for copying. A thrown error or rejected promise leaves the plain code block. One plugin claims a language per machine; a second claim fails registration. The bundled `mermaid` plugin is the reference.

### Navigation sections

**Host-internal, unstable.** `navSections` supply the bodies of the project and workspace lists. PI WEB draws a section only under the reserved ids `projects` and `workspaces`, and keeps the order, keyboard navigation and folding; the section renders the host's snapshot (`NavSectionContext`) through its own rows. The bundled Workspaces plugin is the only contributor.

## Contexts

### Runtime context

Actions and settings sections receive a `PluginRuntimeContext`:

| Member | Description |
|---|---|
| `state.selectedMachine` | `{ id, name, kind }` of the selected machine. |
| `state.selectedWorkspace` | The selected [workspace](#workspace), if any. |
| `state.selectedSession` | `{ id, cwd, path }` of the selected session, if any. |
| `state.status` | `{ isStreaming, backgroundRunCount? }` of the selected session, once read. |
| `state.workspaceTool`, `state.mainView` | The open page and main view. |
| `state.piWebStatus` | The selected machine's PI WEB status. |
| `prompt` | The [prompt editor](#prompt-editor). |
| `openActionPalette()`, `focusPrompt()`, `openThemePicker()`, `reloadPage()` | Open or focus parts of the app. |
| `selectMainView(view)` | `"navigation"`, `"chat"` or a qualified page id. |
| `selectWorkspaceTool(id)` | Open a workspace page by qualified id. |
| `openTerminal({ terminalId? })` | Open the Terminal page, optionally on one terminal. |
| `refreshFiles()`, `refreshAppData()` | Read files or the app's data again. |
| `refreshWorkspacePanels(panelId?)` | Call `onInvalidate` of every workspace page, or of one qualified page. |
| `addProject()`, `startSession()`, `archiveSession()`, `stopActiveWork()` | The app's own commands. |
| `configureAuth()`, `logoutAuth()` | Sign-in commands. |
| `checkForPiWebUpdates()` | **Host-internal, unstable.** Optional. |
| `createProject`, `createMachine`, `removeMachine`, `refreshMachine`, `openMachine`, `projectDirectories`, `projectTrust` | **Host-internal, unstable.** The add-project and add-machine dialogs of the bundled plugins. |

`state` is a snapshot taken when the context was built. Other `state` fields may exist at runtime; they are not part of the contract.

### Prompt editor

| Method | Description |
|---|---|
| `insertText(text)` | Insert at the cursor, replacing a selection; focuses the editor first. Does nothing when no editor is mounted. |
| `getText()` | The prompt text, or `""`. |
| `getSelection()` | `{ start, end, text }`, or `null`. |

Panel contexts target the selected session's editor. Insert text from explicit user actions, such as a button.

### Workspace

```ts
interface Workspace {
  readonly id: string;
  readonly projectId: string;
  readonly path: string;
  readonly label: string;
  readonly isMain: boolean;
  readonly provider?: {
    readonly pluginId: string;
    readonly capabilities: { readonly request: boolean; readonly remove: boolean };
    readonly metadata?: JsonObject;
  };
  readonly removal?: { readonly actionLabel: string; readonly confirmation: string };
  readonly cwdMissing?: boolean;
}
```

Use `label` for presentation. `provider.pluginId` is the owning plugin's stable id; `provider.metadata` is the provider's browser-public metadata, which only that provider's code should interpret. `capabilities.remove` describes this workspace only. `cwdMissing` is true when the folder is gone.

### Workspace page and label contexts

Workspace panels receive a `WorkspacePanelContext`; workspace labels receive a `WorkspaceLabelContext`, which has the same members except `prompt` and `terminal`.

| Member | Description |
|---|---|
| `machine` | `{ id, name, kind }`: the machine this page is for. Key every cache by it. |
| `workspace` | The [workspace](#workspace) shown. |
| `state` | The [runtime state](#runtime-context) snapshot. |
| `files` | [Workspace files](#files), bound to this machine and workspace. |
| `backend` | [Paired backend](#paired-workspace-backend) requests; present only when this browser entry has an active paired server half. |
| `host.requestRender()` | Re-evaluate `visible`, `badge`, `items` and `render` after your own state changed. |
| `host.workspacePanelFullscreen()`, `host.setWorkspacePanelFullscreen(on)`, `host.workspacePanelFullscreenAvailable?()` | See `fullscreen` under [workspace panels](#workspace-panels). |
| `host.refreshAppData?()` | Ask the host to read the project and workspaces again after the page changed them on disk (a worktree added). |
| `prompt` | The [prompt editor](#prompt-editor). Panels only. |
| `terminal` | [Workspace terminals](#terminals). Panels only. |

### Global page context

| Member | Description |
|---|---|
| `machine`, `state`, `host` | As for workspace pages. |
| `terminal.sessions` | The machine's own terminals, in its home folder: `list`, `start`, `close`, `closeAll`, `continue`, `rename`, `connect`. |
| `terminal.open({ terminalId? })` | Show the global Terminal page. |
| `terminal.runInNewTerminal({ title, command })` | Start a shell in the home folder, type the command once the shell has drawn its prompt, and show it. Resolves once the command is typed, not when it finishes. |
| `terminal.selectedId`, `terminal.autoStart`, `terminal.select(id)` | The terminal selection. |
| `checkForPiWebUpdates()`, `openUpdateCommandSetting()` | **Host-internal, unstable.** Optional. |

## Host UI

`context.ui` (optional) gives a plugin the host's own pieces, so its surfaces match the built-in ones.

| Member | Description |
|---|---|
| `confirm({ title, message, confirmLabel, tone? })` | Ask on the host's dialog. Resolves `true` only for the confirming key; Cancel, Escape, the backdrop and the back gesture resolve `false`. Name the thing in `title`, the consequence in `message`, and use `tone: "danger"` for what cannot be undone. Optional. |
| `showDialog({ label, content, presentation?, onClose? })` | Present your own dialog over the app's modal layer; returns `{ close() }`. `presentation` is `"overlay"` (default), `"alert"` (the compact card, at most 480px wide) or `"fullscreen"` (edge to edge; the content must draw its own close control). |
| `registerModal({ element, … })` | Register a modal you render yourself with the app's focus and stacking. |
| `renderList(model)` | Draw a status list the way every status page draws it. See [Drawing a status list](#drawing-a-status-list). Optional. |
| `readFailure(error, attempt)` | What a failed read means. See [When a read fails](#when-a-read-fails). Optional. |
| `copyText(text)` | Copy with the host's clipboard fallbacks; resolves whether it worked. |
| `describeError(error)` | The host's words for an error. |
| `renderMarkdownHtml(markdown)` | Sanitized HTML, as the transcript renders it; style it with `textStyles`. |
| `surfaceStyles`, `listStyles`, `workspacePanelStyles`, `textStyles`, `actionMenuStyles?` | The host's CSS for interactive surfaces, lists, panel bodies (toolbar, viewer, empty states), formatted text and the ⋯ menu. Adopt them per element instance in `createRenderRoot`. |
| `adoptSheets?(root, groups)` | Adopt CSS groups into a shadow root through the host's mechanism. |
| `renderDisclosureIcon?(collapsed)`, `renderCloseIcon?()`, `placeActionMenu?(trigger)` | The host's disclosure chevron, close mark, and ⋯ menu placement. |
| `breakpoints` | Media queries: `coarseOrMobile`, `mobileNavigation`, `desktopSideBySide`, `shortViewport`. |
| `query.read(namespace, key)`, `query.write(namespace, key, value, { replace? })` | Namespaced query-string state kept with the app's route; use it for deep links. |

### Drawing a status list

A page that lists things (runs, services, records) hands its rows to `ui.renderList(model)` and puts the returned template in its render.

```ts
render: (context) => ui?.renderList === undefined
  ? html`<p>This page needs a newer PI WEB.</p>`
  : ui.renderList({
      read: "ready",
      words: { empty: "No runs yet.", reading: "Reading runs…", failed: "Could not read the runs.", stale: "Could not refresh - showing the last read." },
      groups: [{
        id: "running",
        heading: "Running",
        rows: [{ id: "a1", title: "pnpm test", status: { label: "running", tone: "good" }, detail: "started 12:41 · 1m 52s" }],
        actions: [{ id: "stop", label: "Stop all", run: () => { stopAll(); } }],
      }],
      notes: ["3 older runs not shown"],
    }),
```

- `read` is `"reading"`, `"ready"` or `"failed"`. A list with no rows draws one centred box with the matching words, so "not read yet", "none" and "could not read" never look alike. Rows from an earlier read stay on a failed read, under the `stale` line.
- A status `tone` is `"good"`, `"attention"`, `"problem"` or `"neutral"`. Use `value` instead of `status` for a plain fact such as a version.
- Groups with neither rows nor actions are left out. Titles wrap to two lines.

### When a read fails

Pass the error and the number of misses in a row (from 0) to `ui.readFailure(error, attempt)`:

- `{ kind: "retry", delayMs, reason? }`: no answer, or a server error. Keep what is known for the same key, read again after `delayMs` (1, 2, 4, 8 s, then every 15 s) and sooner when the page comes back into view, and say at most "Reconnecting…".
- `{ kind: "final", words }`: a refusal the server stated, such as signed out or gone. Stop retrying and show `words`.

An action the reader started (start, close, rename) is not a read: when it gets no answer, read the state again to learn whether it happened before repeating anything that is not safe to repeat.

## Workspace helpers

### Files

`files` is bound to the callback's machine and workspace and works the same for local and remote machines. Paths are workspace-relative; the host refuses paths that leave the workspace.

| Method | Description |
|---|---|
| `readFile(path)` | `{ path, content, truncated, binary, size, modifiedAt, encoding, language?, mediaType?, mimeType? }`. |
| `listFiles(path)` | `{ path, entries, scannedAt, truncated }`; each entry is `{ name, path, type: "file" \| "directory" \| "symlink", size?, modifiedAt? }`. `""` is the workspace root. When `truncated`, the listing is partial. |
| `writeFile(path, content, { createDirs = true, overwrite = true })` | Write a string or `Uint8Array`; `{ path, size, modifiedAt, created }`. |
| `deleteFile(path)` | Idempotent: `{ path, existed }`. Deletes a symlink itself, never its target; refuses a directory. |
| `moveFile(from, to, { createDirs = true, overwrite = false })` | Rename or move within the workspace; refuses an existing target unless `overwrite`. |
| `uploadFiles(files, { destinationFolder?, createDirs?, overwrite?, onProgress? })` | Upload `File`s one after another, each to `<destinationFolder>/<file.name>`; returns `{ promise, cancel() }`. `onProgress` reports per-file and batch progress. |
| `previewUrl(path, { modifiedAt?, download? })` | A browser-ready URL to stream or download a file. Never build one yourself. |
| `limits` | `{ inlinePreviewBytes, streamPreviewBytes }`: files above the inline limit go through `previewUrl`. |
| `uploadFolder` | The workspace's configured default upload folder. |

After a write, delete, move or upload, the Files page updates by itself. A rejected call carries a refusal code when the path is missing or not a directory; `workspaceFileRefusalOf(error)` returns `"path-missing"`, `"path-not-a-directory"` or `undefined`, so an optional directory can be told apart from a failure:

```ts
import { workspaceFileRefusalOf } from "@gang-of-beads/pi-web/plugin-api";

async function listOptional(files, path) {
  try {
    return { read: "ready", entries: (await files.listFiles(path)).entries };
  } catch (error) {
    if (workspaceFileRefusalOf(error) === "path-missing") return { read: "ready", entries: [] };
    return { read: "failed", error };
  }
}
```

Workspace files can hold secrets (such as `.env`); a browser half that reads them exposes them to the page.

### Terminals

`terminal` on a workspace page runs in the current workspace on the page's machine.

| Member | Description |
|---|---|
| `runCommand({ title, command, metadata?, open? })` | Start a command run in a terminal of the workspace; resolves with `{ run, completed }`, where `completed` resolves when the run ends. `open: true` shows it. |
| `open({ terminalId? })` | Show the Terminal page. |
| `sessions` | The workspace's terminals: `list`, `start`, `close`, `closeAll`, `continue`, `rename`, `connect`, `listCommandRuns`, `cancelCommandRun`. |
| `activeCount`, `selectedId`, `autoStart`, `select(id)` | The terminal state of the workspace. |

Commands are shell source, typed into a terminal as written.

### Paired workspace backend

`backend.request(operation, input)` calls `request()` of the [workspace provider](#workspace-provider-contract) that owns the callback's workspace, when that provider is this plugin's own active server half.

```js
if (context.backend === undefined) return html`<p>The workspace backend is not available.</p>`;
const summary = await context.backend.request("summary", { includeIgnored: false });
```

The host binds the call to the plugin's id and active backend revision and to the callback's machine, project and workspace, resolves the workspace's owner again, and dispatches only when the same active plugin still owns it. Operation ids match `^[a-z][a-z0-9.-]*$` and are at most 128 characters. Inputs and results are JSON only. A missing or inactive backend, a stale revision or workspace, a change of owner, an unsupported operation, invalid JSON, a failure or a timeout rejects the promise with an attributed error.

## Server entry

```ts
import type { PiWebServerPlugin } from "@gang-of-beads/pi-web/server-plugin-api";

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Example",
  activate: (context) => ({
    operations: {
      "items.list": async (input, { signal }) => ({ items: await readItems(context.storage, signal) }),
    },
    stop: async () => { /* release what start or activate acquired */ },
  }),
};

export default plugin;
```

The default export has `apiVersion: 1`, a non-empty `name` and `activate(context)`, which may be async. Server entries run in the session daemon. They also run in the web server when the entry declares `runs: "web"` or `"both"` (host-internal); today the session daemon activates such an entry too, so its callbacks run once per process.

### Server activation context

| Member | Description |
|---|---|
| `apiVersion` | `1`. |
| `pluginId` | The plugin id. |
| `packageRoot` | The package's canonical directory. |
| `settings` | A JSON copy of `plugins.<id>.settings` taken at activation (`{}` when none). |
| `logger` | `debug`, `info`, `warn`, `error(message, details?)`, attributed to the plugin in `pi-web logs`. |
| `storage` | [Plugin storage](#storage). |
| `execFile(request)` | [Bounded command execution](#execfile). |
| `ports` | [Host ports](#host-ports). Optional. |
| `signal` | The signal of this `activate` call: aborted when activation times out or settles. It is not a plugin-lifetime signal. |

### Storage

`storage` keeps JSON documents in the plugin's own directory, `$PI_WEB_DATA_DIR/plugin-storage/<plugin-id>/`.

| Member | Description |
|---|---|
| `read(key)` | The document, or `undefined` for a key never written or a document that cannot be parsed. `undefined` means "nothing stored", not "empty". |
| `write(key, value)` | Write through a temporary file, so a crash never leaves half a document. |
| `remove(key)` | Remove the document. |
| `directory` | The directory path. |

Keys match `^[a-z0-9][a-z0-9._-]*$` (case-insensitive); other keys are refused.

### execFile

`execFile({ file, args?, cwd?, env?, unsetEnv?, timeoutMs?, signal })` runs a program with an argument list, without a shell, and resolves with `{ exitCode, signal, stdout, stderr, stdoutTruncated, stderrTruncated }`. The host caps the timeout at 30 seconds and each output stream at 2 MiB. Pass the signal of the callback you are in.

### Host ports

Ports are optional services a host hands its plugins. A host that cannot supply one leaves it undefined; a plugin that needs it reports an unhealthy `health()` instead of failing.

| Port | Supplied by | Description |
|---|---|---|
| `sessionTranscripts` | session daemon | Read-only access to this machine's session transcripts: `listSessions(cwd)` and `readMessages({ id, cwd }, { before?, limit? })` (100 messages by default, at most 500). `readMessages` answers `undefined` when the file is gone or unreadable. While the daemon's session service starts, every method throws an `Error` whose message is `SESSION_TRANSCRIPTS_NOT_READY`: retry later, never read it as "no sessions". |
| `workspaceCatalog`, `piWebConfig` | web server | **Host-internal, unstable.** Resolve a workspace to its paths; read a project's path-access config. |
| `machinesStorePath`, `localRuntime`, `machineRegistry` | web server (`machineRegistry`: none today) | **Host-internal, unstable.** For the bundled Machines plugin. |

### Activation result

| Field | Description |
|---|---|
| `operations` | [Named JSON operations](#operations). |
| `workspaceProvider` | One [workspace provider](#workspace-provider-contract). |
| `agentFacts` | [Facts about the agent-side feature](#agent-facts) the plugin fronts. |
| `backgroundWork(session, signal)` | [Background runs](#background-work) the plugin knows a session still has going. |
| `start(signal)`, `stop(signal)` | Acquire and release resources; each call is bounded by the lifecycle timeout. |
| `health(signal)` | `{ status: "healthy" \| "degraded" \| "unhealthy", message?, details? }`. Checked once while the daemon builds its workspace authority at start: an unhealthy provider is left out, a degraded one stays eligible. |
| `routes` | **Host-internal, unstable.** [HTTP routes](#routes). |
| `machineRegistry` | **Host-internal, unstable.** The machine registry the bundled Machines plugin owns. |

A plugin contributes at most one `workspaceProvider`; returning `workspaceProviders` is refused.

### Operations

`operations` maps names to handlers. The host serves each at `api/plugins/<plugin-id>/<name>` on its machine; a browser half calls it with `context.callOperation(name, input)`, which also reaches a remote machine's copy through the gateway.

```ts
type ServerPluginOperation = (input: unknown, context: { signal: AbortSignal }) => JsonValue | Promise<JsonValue>;
```

- Names match `^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$`, such as `goals.list`. An invalid name fails activation.
- `input` is the JSON request body (at most 256 KiB), unvalidated: check it. The result must be JSON; `undefined` answers `null`.
- The signal fires when the caller goes away and when the plugin is turned off. Operations run in the session daemon; the host imposes no deadline of its own, so bound long work yourself.

### Agent facts

```ts
interface ServerPluginAgentFacts {
  surfaces?: { surface: string; tools: string[] }[];
  injectedTurns?: { id: string; marker: string; producer: string }[];
  workPaths?: { root: "cwd" | "session-dir" | "session-stem"; path: string }[];
}
```

- `surfaces` names an agent-side surface and the tools that back it; any one of the tools registered by a loaded Pi extension backs the surface. A browser page names the surface in `fronts`, and the extension that registers those tools brings no Go to key of its own for its widgets.
- `workPaths` lists directories the plugin's extension writes background work into. `root` is the session's working directory (`cwd`), the directory holding its transcript (`session-dir`) or the directory named after the transcript file (`session-stem`); `path` is relative, stays inside the root, and may be empty only under `session-stem`. While the plugin runs, the daemon watches each directory and its parent and recounts the session's background runs when they change; the Files and Git pages ignore writes under the `cwd` directories.
- `injectedTurns` is validated and recorded, but the current host does not act on it.

The daemon reads agent facts when it starts and again after each live toggle.

### Background work

`backgroundWork(session, signal)` answers `{ running }`, how many runs the plugin knows a session still has going after its own turn. The daemon adds every running plugin's answer into the session's "N background runs", shown in the status line and waited on by goal continuation. `session` is `{ sessionId, cwd, sessionFile, parentActive }`. The daemon asks while background work is known or being watched for, so keep a zero answer cheap; `running` is a non-negative integer. A failed or late answer keeps the last count. The call is bounded by the lifecycle timeout. [pi-web-subagents](https://github.com/Gang-of-Beads/pi-web-subagents) and [pi-web-background-runs](https://github.com/Gang-of-Beads/pi-web-background-runs) count their runs this way.

### Routes

**Host-internal, unstable.** A route is `{ method, path, handle(request, reply, context) }`, with `method` one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and `path` starting with `/`. Only the web server mounts routes, under `/api` and `/api/machines/local`, and only those of entries that declare `runs: "web"` or `"both"` and were active when it started. A route that collides with an existing one is refused and logged. The handler's signal fires when the client disconnects or the plugin is turned off.

## Workspace provider contract

The session daemon is the single authority for a project's workspaces. One active provider owns a project; see [which provider owns a project](plugins.md#git).

```ts
interface WorkspaceProvider {
  fallback?: boolean;
  probe(project: ProjectInput, signal: AbortSignal): Promise<"claim" | "pass">;
  list(project: ProjectInput, signal: AbortSignal): Promise<ProviderWorkspace[]>;
  request?(context: ProviderRequestContext): Promise<JsonValue>;
  prepareRemove?(context: ProviderRemoveContext): Promise<WorkspaceRemovePlan>;
}

interface ProviderWorkspace {
  key: string;
  path: string;
  label: string;
  isMain: boolean;
  data?: JsonValue;
  publicMetadata?: JsonObject;
  removal?: { actionLabel: string; confirmation: string };
}
```

- `ProjectInput` is `{ id, name, path }`.
- `probe` returns only `"claim"` or `"pass"`. Claim conservatively. Leave `fallback` unset for a provider that should be asked before the bundled Git provider.
- `list` runs only for the owner. Return stable provider-local keys, accessible absolute directory paths, unique keys and paths, non-empty labels, and exactly one main workspace.
- `data` is handed back to the provider privately during the same resolution. `publicMetadata` becomes `workspace.provider.metadata` and is visible to all browser code and API consumers: never put secrets in it or in removal wording.
- `request` receives `{ project, workspace, operation, input, signal }`, with a frozen, host-validated workspace, and returns JSON. It answers [`backend.request`](#paired-workspace-backend).
- `removal` is display text and requires `prepareRemove`; it advertises removal for that workspace only.
- `prepareRemove` returns `{ title, command }` for a visible host terminal run. Returning the plan approves the removal; it is not done yet. `command` is shell source run by the host's login shell in a safe directory outside the target, so use the supplied absolute `workspace.path`, shell-quote it, and keep the removal in the foreground. The host records completion when the shell exits, exit status 0 meaning success.
- A claimant that fails `list` is reported as degraded; it does not let a fallback take over in the same resolution.
- A plugin that supplies a workspace provider takes effect at the next session-daemon start, not on a live toggle.

The bundled `git` plugin and [`examples/workspace-provider-plugin`](../examples/workspace-provider-plugin/) implement this contract.

## Lifecycle guarantees

A server half can rely on these:

- `activate`, `start`, `stop`, `health` and `backgroundWork` are each bounded by the 10-second lifecycle timeout, and receive a signal scoped to that one call. Do not keep a signal as a plugin-lifetime notification; release resources in `stop`.
- `stop` runs exactly once after every `start` that resolved, whether the plugin is turned off or the process shuts down. A `start` that fails is rolled back with `stop`.
- No operation or route handler starts after `stop` begins; calls still running are aborted and given up to the lifecycle timeout to settle first.
- Turning the plugin on again calls `activate` again; nothing the earlier activation returned is reused. A process keeps a module it imported for the same revision, so module-level state outlives a toggle: keep per-activation state inside `activate`.
- A `stop` that throws or times out leaves the plugin `failed` in phase `stop`.
- Plugins activate in id order and stop in reverse.

A browser half can rely on these:

- `dispose` runs at most once per `activate`, when the plugin is turned off or its machine stops listing it. Closing or reloading the page does not call it.
- Listeners registered with `on` are dropped with the plugin.
- A `dispose` that throws is reported in the browser console, and the plugin is removed anyway.
- Turning the plugin on again calls `activate` with a new context. The page keeps an evaluated module for as long as it is open, so module-level state outlives a toggle.
- A module that fails to import, an `activate` that throws, or contributions the host refuses leave nothing of the plugin on the page; its card in Settings says "Did not load in this browser" with the reason.
- While a plugin stays on, a newer revision of its browser module is used only after the page reloads.

What toggling does, step by step, is in [PI WEB plugins](plugins.md#what-happens-when-a-plugin-is-turned-on-or-off).

## Limits

| Limit | Value |
|---|---|
| Package scan | 4,096 directory entries, 16 MiB of file content |
| Lifecycle callbacks (`activate`, `start`, `stop`, `health`, `backgroundWork`, module import) | 10 seconds each |
| `execFile` | 30-second maximum timeout; 2 MiB per output stream |
| Operation request body | 256 KiB |
| Workspace backend: input / result | 256 KiB / 8 MiB of JSON |
| Workspace backend: provider callback / whole dispatch / through a gateway | 10 s / 25 s / 30 s |
| Workspace backend operation id | 128 characters |
| Plugin id, contribution id | `^[a-z][a-z0-9.-]*$` |
| Operation name | `^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$` |
| Storage key | `^[a-z0-9][a-z0-9._-]*$`, case-insensitive |

## Errors and status codes

Operation calls (`callOperation`, `api/plugins/<plugin-id>/<operation>`):

| Status | `code` | Meaning |
|---|---|---|
| 200 | | The handler's JSON result. |
| 400 | `plugin-operation-refused` | Invalid plugin id or operation name. |
| 404 | `plugin-operation-refused` | No active plugin of that id, or no operation of that name. |
| 409 | `plugin-not-active` | The plugin is turned off, failed or waiting for a restart; `state` says which. |
| 500 | `plugin-operation-refused` | The handler threw; `error` carries its message. |
| 502 | `daemon-unavailable` | The web server could not reach the session daemon. |

Routes of a plugin that is not active answer `409` with `code: "plugin-not-active"`; a route new since the web server started answers `404`.

Registration errors appear in **Settings → PI WEB plugins** and the browser console: invalid plugin or contribution id, duplicate contribution id, unsupported API version, a second claim on a message tag, tool name or code-fence language, a removed contribution kind. Package errors appear on the plugin's card and in `pi-web logs`: an invalid or reserved id, a missing module, an unsafe path, a browser path that does not match the package's directory entries exactly, `runs` without `serverModule`, an unknown host fact, a package over the size limit, a duplicate id.

## Manifest and browser assets

The page reads `pi-web-plugins/manifest.json`, which lists each browser module PI WEB offers:

```json
{
  "lifecycleVersion": 1,
  "plugins": [
    {
      "id": "example",
      "module": "/pi-web-plugins/example/dist/browser/pi-web-plugin.js?v=<content-revision>",
      "backendRevision": "<active-server-revision>",
      "source": "npm:@your-scope/pi-web-example",
      "scope": "user",
      "machineSpecific": true
    }
  ]
}
```

- `source` is where the plugin came from (`bundled`, `local`, `dev` or the Pi package source); `scope` is `bundled`, `local`, `user` or `project`.
- A server-only entry has no manifest record. A dual entry is listed only while the session daemon runs the same package, settings and revision, and its backend is not unhealthy; `backendRevision` pairs the two halves.
- A remote machine's manifest is served through the gateway, and its modules are rewritten to gateway-scoped URLs under machine-scoped runtime ids.

A file under `browserRoot` is served at `pi-web-plugins/<plugin-id>/<package-relative-path>` under the PI WEB address. Files outside `browserRoot`, including a server module, sources, metadata and dependencies, are not served. `browserRoot: "."` makes almost the whole package public: prefer a narrow output directory, and never place secrets in it. `.js` and `.mjs` are served as JavaScript; JSON, CSS, HTML and SVG with their types; anything else as `application/octet-stream`. PI WEB serves the files that exist in the package; it runs no build and copies no `public/` directory.

Reference assets relative to the module, never by an absolute path:

```js
const iconUrl = new URL("./assets/icon.svg", import.meta.url);
```

A bundled module is one file, so `import.meta.url` is the entry's URL everywhere in it; place assets relative to the entry. Module-relative URLs keep working on remote machines and under a reverse-proxy path prefix; a hard-coded `/pi-web-plugins/...` path does not.
