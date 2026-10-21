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

`@gang-of-beads/pi-web` has `node-pty`, a native module a plugin does not need, as an optional dependency. Install with scripts disabled (`npm install --ignore-scripts`, or `ignore-scripts=true` in the plugin's `.npmrc`). A lightweight package, `@gang-of-beads/pi-web-plugin-api`, is published as an alpha (`npm install --save-dev @gang-of-beads/pi-web-plugin-api`) with the same declarations and public runtime helpers and without `node-pty`. The reference plugins still depend on `@gang-of-beads/pi-web` as above. See the [standalone package README](https://github.com/Gang-of-Beads/pi-web/blob/main/packages/pi-web-plugin-api/README.md) for its browser dependency, bundling and compatibility requirements.

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

- Optional context members (`on`, `sessions`, `machines`, `fleet`, `callOperation`, `ui`, `ui.confirm`, `ui.renderList`, `ui.renderButton`, `ui.renderOutput`, `ui.renderMessageField`, `ui.renderExpandableRow`, `ui.readFailure`, a workspace page's `session` and `composer`, `host.workspacePanelFullscreenAvailable`, the composer context's `signal` and others marked optional) are absent on hosts older than the member. Check before calling, and degrade with a sentence the reader can act on ("This page needs a newer PI WEB").
- A browser contribution kind the host does not know is ignored.
- A server activation field the host does not know is ignored and logged: "server plugin activation carries an unknown field; the running host does not implement it".
- A `piWeb.plugins[]` field the host does not know is ignored.
- Enumerated values in facts and results may gain members in later releases: a fact's `kind`, `reason` or `outcome`, a board's `coverage`, a machine's `reachability`, and what `openSession` and the machine management calls answer. Treat a value you do not know as unknown, never as one you know, and give a `Record` over such a union a fallback.

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
| `sessionCommands` | string[] | none | The extension commands the plugin's pages run in the session on screen, by name without the slash: at most 16 distinct names matching `^[a-z0-9][a-z0-9:_-]*$`. Shown on the plugin's card in Settings. See [Running a session command](#running-a-session-command). |

Each entry needs at least one of `module` and `serverModule`. Module paths and `browserRoot` must be safe canonical relative paths to existing files and directories inside the package: no backslashes, no absolute or drive-qualified paths, and no empty, `.`, `..`, `.git` or `node_modules` segments (`browserRoot` may be exactly `.`). The browser module must stay inside `browserRoot` both as written and after resolving symlinks, and the browser paths must match the directory entries exactly, including case.

`piWeb.plugin` (singular), string entries, `piWeb.id` and packages without `package.json` are refused. `piWeb.title` belongs to Pi extension packages ([the extension's name](pi-extensions.md#the-extensions-name-in-pi-web)). `piWeb.vendorBundles` is read only by PI WEB's own build for its bundled plugins.

### Plugin settings

A plugin's settings live in the PI WEB config under `plugins.<id>.settings` and must be JSON. Both halves receive them (see the contexts below); the browser manifest carries them to every page that opens PI WEB, so never put a secret there that the browser must not see.

A value no browser may read, such as a service key, goes in the private block `plugins.<id>.serverSettings`, which PI WEB keeps out of every browser answer ([Private plugin settings](config.md#private-plugin-settings)). Only the server half receives it, as `context.serverSettings` (see [Server activation context](#server-activation-context)):

```ts
async activate(context) {
  if (context.serverSettings === undefined) {
    context.logger.warn("This PI WEB cannot supply private settings; update it to use a service key");
  }
  const apiKey = context.serverSettings?.["apiKey"];
  // ...
}
```

- Each plugin receives only its own block, as a read-only JSON copy taken at activation; `{}` when none is configured.
- `serverSettings` is `undefined` only on a PI WEB that predates private settings. Treat that as "this host cannot supply a key", not as "no key configured".
- The browser half never receives it: not in its `settings`, not in `settings-changed`, not in the manifest. Do not send it to the browser yourself, in a route answer, an operation result, health details or a log line.
- The value is plaintext on the server: the config file holds it as written, and every trusted server plugin runs in the same process. It keeps a key from browsers, not from the machine.
- Changing a plugin's `serverSettings` takes effect like changing its `settings`: the plugin shows **Restart required**, and its browser half is withheld until the processes that run its server half restart.

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
| `sessions`, `machines` | [Session and machine facts](#session-and-machine-facts): `sessions.onDidCreate(listener)` and the others, each returning its unsubscribe function. Optional. |
| `fleet` | [The fleet](#fleet): every configured machine, its reachability and session board, and the host's navigation to a session on any of them. Optional. |
| `callOperation(name, input)` | Call one of this plugin's own [server operations](#operations) on the machine this copy belongs to; resolves with its JSON result, rejects with the server's error. Optional. |
| `ui` | [Host UI](#host-ui) helpers. Optional. |
| `openPage(pageId)` | Show a page by its qualified id, as Go to does (for example `${runtimePluginId}:global.example`). Optional. |
| `readPiWebStatus()` | **Host-internal, unstable.** The PI WEB status of the machine this copy belongs to. |
| `fetchJson(path, init)` | **Host-internal, unstable.** Calls a PI WEB JSON endpoint by its application path. Use `callOperation` for your own server half. |

### Lifecycle events

| Kind | Payload | When |
|---|---|---|
| `session-selected` | `sessionId`, `machineId` | A session was selected. A new session that is still starting is announced once, with its real id, when it has one. |
| `session-left` | `sessionId`, `machineId` | The selected session was left, including for a new session that is still starting. |
| `connection-changed` | `machineId`, `connected` | The selected machine's announcements socket opened or went away, for the machine named. Nothing is announced before it first opens. Selecting another machine announces that machine's socket. |
| `theme-applied` | `themeId` | A theme was applied. |
| `session-activity-settled` | `sessionId`, `machineId` | The selected session's turn ended, or its last background run ended while no turn runs: what a page shows may have changed. |
| `settings-changed` | `settings` | The plugin's settings changed. A browser-only plugin hears it as soon as the change is saved through Settings or the config API; a plugin with a server half is withheld from the page until the session daemon restarts with the new settings. |

Listeners are dropped with the plugin whether or not `dispose` removes them. A listener that throws is logged in the browser console and the other listeners still hear the event.

### Session and machine facts

`context.sessions` and `context.machines` announce what happened, for a plugin that reacts to it: a notifier, a log, a page that reads again. Each `onDid*` method takes a listener and returns its unsubscribe function; every subscription is dropped with the plugin.

| Method | Payload | When |
|---|---|---|
| `sessions.onDidCreate` | `session` | A session was created on a machine the page hears. |
| `sessions.onDidRename` | `session`, `name` | A session was renamed; `name` is `undefined` when the name was cleared. |
| `sessions.onDidReplace` | `from`, `to`, `reason: "new"` | `/new` ran on the session on screen and its runtime moved on to `to`. |
| `sessions.onDidStartRun` | `session` | A run started that the page saw start. |
| `sessions.onDidEndRun` | `session`, `outcome`, `askedBy` | A run the page saw going ended. |
| `machines.onDidAdd` | `machine` | A machine joined the machine list after the list first loaded. |
| `machines.onDidRemove` | `machineId`, `name` | A machine left the machine list. |
| `machines.onDidChangeReachability` | `machine`, `previous` | The host's answer about a machine changed, for example from `online` to `offline`. `checking` is not an answer, so going to or from it announces nothing. While any plugin listens, the host keeps checking every machine's reachability at the Machines list's pace: one read per machine every 15 seconds, sooner at first for a machine that does not answer. Unsubscribe when the answers are no longer needed. |

`session` (and `from`, `to`) is a scope: `machineId` and `sessionId` always, and `cwd`, `projectId` and `workspaceId` when the page knows them. A missing member means the page does not know it. `machine` is a [fleet machine](#fleet).

Facts are announcements, never hooks:

- **Not awaited.** A fact reaches listeners shortly after the change, never in the middle of it, and the host does not wait for them.
- **Contained.** A listener that throws is logged in the browser console. The other listeners still hear the fact.
- **Frozen.** A fact is frozen all the way down and shared by every listener.
- **Not replayed.** A plugin that subscribes late hears nothing about earlier changes. Read [the fleet](#fleet) for state, and use facts only to learn that something changed.
- **Only what the page hears.** Session facts come from the announcements of each listed machine not known to be down, and from the stream of the session on screen. `onDidReplace` is heard only for the session on screen. A machine the page cannot hear produces no facts. Silence is not evidence that nothing happened.

`outcome` says how a run ended as far as the page can tell. The page announces a start only when it knew the session was idle before, so a run already going when the page began listening has no start, but its end is announced. Every start is followed by exactly one end. When the page may have missed a machine's announcements (its connection dropped, or the machine left the list), every run of that machine it saw going ends at once on what the page heard of it; a run that is in fact still going is then heard again as a run already going, so its end is announced a second time, without a start.

`outcome` uses the same words as the [server facts](#server-facts) and the transcript:

| `outcome` | Evidence |
|---|---|
| `stopped` | The reader's Stop cut the run: the page heard a stop by the reader, or the run's last reply was stopped by the reader. |
| `interrupted` | The run was cut otherwise: the run's last reply was interrupted, or the page heard the session's runtime close under the run. |
| `failed` | The run ended on an error pi did not retry: its last reply ended in an error, or the session's activity was an error when the run settled. |
| `completed` | The page heard the whole run on the session's own stream: it began and ended there with no announcement of it from its machine in between, the stream had no gap while it ran, its last reply finished, and the page heard no stop. |
| `unknown` | Anything else. This includes every run of a session that was not on screen and did not end on a stop or an error, and a run whose stream had a gap without a stop or an interruption heard after it. A gap is a lost connection (a session-daemon restart, for example), frames the page could not replay, or the page leaving the session. |

An error the page heard mid-run that the run went on past, such as an extension error or a model default that was not saved, does not make the run `failed`.

`askedBy` says which device sent the newest user message the run took, that is one the agent had not yet taken when the page saw the run start. A plugin can then act only on the device that asked, for example to play a sound when a run finishes:

| `askedBy` | Meaning |
|---|---|
| `this-device` | This browser profile sent it. Every tab of one profile is the same device. |
| `another-device` | Another browser profile sent it. |
| `unknown` | Anything else. This includes a run whose start the page did not see, a run that took no user message (one an extension started), a message from the terminal or an extension, a session that was not on screen or whose transcript was not loaded, and a machine running a PI WEB too old to record the device. Hosts older than `askedBy` leave it out; read that as `unknown`. |

The device is the random id each browser profile already sends with its messages; the machine records it on each message it receives from a browser, so other browsers of the machine can read it in the transcript.

Archiving, restoring and deleting a session have no facts: no announcement carries them, and a fact limited to this page's own actions would miss every other device.

### Contribution ids

Every contribution has a local `id` matching `^[a-z][a-z0-9.-]*$`, unique within the plugin. The host qualifies it as `<runtimePluginId>:<id>`; that qualified id is what `selectWorkspaceTool`, `openPage`, `refreshWorkspacePanels`, shortcut preferences and route aliases use. An invalid or duplicate id fails the plugin's registration ("Invalid contribution id", "Duplicate contribution id").

## Contributions

`activate` returns `{ contributions }`, an object with any of these arrays:

| Kind | Adds |
|---|---|
| [`actions`](#actions) | Entries in the action palette, with optional shortcuts. |
| [`workspacePanels`](#workspace-panels) | Pages of a project, listed in Go to. |
| [`globalPanels`](#global-pages) | Pages needing no project, about the machine on screen or about every machine. |
| [`workspaceLabels`](#workspace-labels) | Short inline items beside each workspace in the workspace list. |
| [`sessionSections`](#session-sections) | Sections in every list of sessions. |
| [`activityNotes`](#activity-notes) | A short line beside a session's activity state. |
| [`composer`](#composer-controls) | Controls in the message composer. |
| [`settingsSections`](#settings-sections) | Sections in the Settings dialog. |
| [`themes`, `themePairs`](#themes-and-theme-pairs) | Themes and light/dark pairs. |
| [`messageActions`](#message-actions) | A button on each transcript message of the roles it names. |
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
- `fullscreen: true` lets the page take the whole app canvas on a wide window. PI WEB draws no enter or exit control for it: draw an enter control while `host.workspacePanelFullscreenAvailable?.()` is true that calls `host.setWorkspacePanelFullscreen(true)`, and an exit control while `host.workspacePanelFullscreen()` is true. PI WEB ignores the request from a page that did not declare `fullscreen`, gives the canvas back when the reader opens another page, Chat or Sessions, and keeps the request while the window is too narrow. The bar above the page keeps the app's corner keys: Back returns to the Go to list, Go to folds the page column away and keeps the request until the column opens again, and over the list the grid key gives the canvas back and opens the navigation panel. Hosts older than `workspacePanelFullscreenAvailable` lack it: offer no enter control there.

What `toolbar` and `render` return is drawn inside the host's panel, which carries the panel styles: classes such as `toolbar`, `viewer`, `empty-state` and `muted` apply to it. Inside your own element's shadow root those styles do not reach; adopt `ui.workspacePanelStyles` there (see [Host UI](#host-ui)).

### Global pages

A global page needs no project. It is about the machine on screen, or with `scope: "fleet"` about every machine. Contribute it under `globalPanels`; a plugin may bring both kinds.

```ts
interface GlobalPanelContribution {
  id: string;
  title: string;
  icon?: TemplateResult;
  order?: number;
  routeAliases?: string[];
  scope?: "machine" | "fleet";
  visible?: (context: GlobalPanelContext) => boolean;
  fronts?: string;
  badge?: (context: GlobalPanelContext) => string | number | TemplateResult | undefined;
  toolbar?: (context: GlobalPanelContext) => TemplateResult;
  render: (context: GlobalPanelContext) => TemplateResult;
}
```

Go to lists the pages of the scope the reader is looking at. On the Navigate page its switch decides: a project offers that project's pages, `All projects` offers the global pages. Elsewhere Go to follows what is open: a project's session or page offers its project pages; nothing open, or a global page, offers the global pages. In a project's scope a global page also appears when its plugin brings no project page. Global pages are never drawn on the whole canvas. The [global page context](#global-page-context) has no workspace, files or prompt, so a global page cannot reach a project by accident.

`scope` says what the page is about. `"machine"` (the default) is a page about the machine on screen: each machine's copy of the plugin brings its own page, shown while that machine is selected. `"fleet"` is one page about every machine. The copy of the plugin this PI WEB serves itself brings it, so it is listed once whichever machine is selected and keeps its id when the selection changes. A remote machine's copy of a fleet page is ignored while this PI WEB has the plugin; a plugin installed only on remote machines brings it from the first remote copy the page loaded, listed once too. A fleet page takes its machines from [`context.fleet`](#fleet), never from `context.machine`.

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
  presentation?: (context: ComposerRuntimeContext) => { title?: string; icon?: TemplateResult; pressed?: boolean } | undefined;
  run: (context: ComposerRuntimeContext) => void | Promise<void>;
}
```

- `available: false` removes the control: use it for a capability the machine lacks. `enabled: false` greys it out: use it for "not right now", with a `disabledReason`.
- `status` is a status line the composer shows for the control (a dictation in progress, or why it stopped).
- `presentation` is the control's live state, read on every redraw: `pressed` draws the control as a toggle (`aria-pressed`, the pressed style), and `title` and `icon` replace the declared ones while the state lasts, for example "Stop" while something the control started is going. Call the context's `requestUpdate()` when the state changes. A `presentation` that throws is logged in the browser console and the control is drawn with its declared title and icon. Hosts older than `presentation` ignore it and draw the declared title and icon.
- The context carries `sessionId`, `machineId`, `draft`, `busy`, `signal` (optional), and `insertText`, `replaceDraft`, `notify(message, severity)`, `requestUpdate()` and `send()` (optional).
- `send()` presses Send for the context's session: the draft on screen and its attachments go exactly as the Send button sends them, a steer while a turn runs and a follow-up otherwise. Put the words in the draft first with `replaceDraft`, where the reader sees them and can change them; a composer control's `send()` sends only the draft on screen, never words of its own. (A [page](#writing-the-draft-and-sending-from-a-page) can send words of its own, marked with the plugin that sent them.) It answers `"sent"`, `"empty"` (nothing to send), `"left"` (the composer no longer shows that session; nothing was sent, and a stored draft is never sent) or `"not-stored"` (this browser could not store the message, which stays in the composer). A file still being attached, or a send still being written, is waited for first. The message records which plugin sent it: its details show "Sent with <plugin name>" on every device. A message the reader sends with the Send button carries no such mark, even when a plugin wrote the draft. Hosts older than `send` do not supply it: check for it and ask the reader to tap Send instead.
- A context belongs to the machine and session the composer showed when it was made. The composer is reused across sessions, so work that outlives the click, such as a dictation still streaming, has to stay with that session:
  - A new session is shown while it is still starting, under a temporary id. When it gets its real id, a context made before then reports the real id in `sessionId`; it is the same session, and nothing else about the context changes. This happens at most once per context, so read `sessionId` when you need it, for example to find your work for the session on screen, instead of keeping a copy from the click.
  - `signal` is an `AbortSignal` that aborts when the composer leaves the session (the reader switches session or machine, or the composer unmounts); a new session getting its real id is not leaving it. It is already aborted if that happened before your code received the context. Stop the work when it fires. Hosts older than `signal` do not supply it: check for it, and on such a host keep the work bound to the context without stopping it.
  - `insertText` and `replaceDraft` called after the composer left the session write to that session's stored draft, which the reader finds on going back, never to the session now on screen. A context made before the composer had a session has no stored draft, so those late writes are discarded. Use the context each `run` receives: a context kept from an earlier `run` still writes to that earlier session.

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

Themes appear in **Settings → Appearance**. `tokens` sets every `LegacyThemeToken` (the CSS custom properties `--pi-bg`, `--pi-surface`, `--pi-text`, `--pi-accent` and the rest of the type) and may set the surface ladder (`--pi-surface-canvas`, `-panel`, `-card`, `-raised`, `-active`, derived from the legacy tokens when absent) and `--pi-on-accent`. It may also colour the conversation's messages by who wrote them: `--pi-msg-user-bg`, `-border` and `-header-bg` and the same three for `assistant` and `system`. Each one it leaves out is derived from its own tokens: user messages from `--pi-selection-bg` and `--pi-accent-border`, assistant messages from `--pi-surface` and `--pi-border`, and system messages from the purple family (`--pi-purple-surface`, `--pi-purple-border`) so they read apart from the assistant's. An assistant or system header fill it leaves out follows that message's own background, so a theme can recolour a card with one token. A theme pair names a light and a dark theme of the same plugin by local id; the reader can let the system's preference choose between them. `replacedBy` names another theme by qualified id (`core:material-dark`, `core:material-light` or `<plugin>:<theme>`): when that theme exists and declares no `replacedBy` of its own, Settings hides this entry and a saved choice of it moves to the target. Otherwise the entry stays selectable with its own tokens, so hosts that predate the field keep working. A `replacedBy` that is not a qualified id fails the plugin's registration, like an invalid theme id. Themes from a remote machine are ignored, because a theme applies to the whole app.

### Message actions

A message action is a button on transcript messages, such as "Translate this reply" or "Save to notes".

```ts
interface MessageActionContribution {
  id: string;
  title: string;
  icon: TemplateResult;
  roles: readonly ("assistant" | "user")[];
  order?: number;
  available?: (row: MessageActionRow) => boolean;
  presentation?: (row: MessageActionRow) => { title?: string; icon?: TemplateResult; pressed?: boolean } | undefined;
  run: (row: MessageActionRow) => void | Promise<void>;
}

interface MessageActionRow {
  readonly machineId: string;
  readonly sessionId: string;
  readonly cwd: string | undefined;
  readonly messageId: string;
  readonly role: "assistant" | "user";
  readonly text: string;
  readonly streaming: boolean;
  readonly requestUpdate: () => void;
}
```

- The button is drawn left of Copy, in the same box and with the same visibility as the message's own buttons: always shown on a touch screen, on hover or focus with a mouse. It appears only on messages Copy is offered for, that is user and assistant messages with words in them.
- `title` is the button's accessible name and tooltip; `icon` is drawn inside the host's box, which the plugin cannot resize.
- `row` carries the message's scope (machine, session, folder when known), `messageId`, which identifies the row across redraws, and `text`, exactly what Copy takes: the text parts, trimmed, with a blank line between them. `streaming` is true for the reply still being written; `text` is then what has arrived so far.
- One exception to a stable `messageId`: a reply that is still being written before the provider sends its id is known by its place in the transcript, and its `messageId` changes once, when the id arrives. State kept under the earlier value, such as a pressed toggle, is not found under the new one.
- `available: false` removes the button from that row. `presentation` is read on every redraw: `pressed` draws the button as a toggle (`aria-pressed`), and `title` and `icon` replace the declared ones while the state lasts, for example a stop icon while something plays. Call `row.requestUpdate()` after state only the plugin sees changed.
- Only the selected machine's registrations draw buttons. One action per plugin per role: two actions of one plugin that name the same role fail its registration.
- A `run` that throws or rejects is logged in the browser console and the reader sees "<title> failed: <reason>". An `available` that throws is logged and the button is not drawn on that row. A `presentation` that throws is logged and the button is drawn with its declared title and icon.

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
| `createProject`, `createMachine`, `removeMachine`, `refreshMachine`, `openMachine`, `renameMachine`, `projectDirectories`, `projectTrust`, `projectFolders` | **Host-internal, unstable.** The add-project and add-machine dialogs of the bundled plugins. A page manages machines through [the fleet](#fleet). |

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
| `session?` | The session on screen, for a page whose package declares `sessionCommands`: `{ id, runCommand(request) }`. Absent with no session open, without the declaration, and on older hosts. Panels only. See [Running a session command](#running-a-session-command). |
| `composer?` | The draft and Send of the session on screen, for any page: `{ draft(), setDraft(text), insertText(text), send(text?) }`. Absent with no session open, for an archived session, and on older hosts. Panels only. See [Writing the draft and sending from a page](#writing-the-draft-and-sending-from-a-page). |

### Running a session command

A page runs one of its package's declared extension commands in the session on screen, as typing it would:

```ts
const outcome = await context.session?.runCommand({ sessionId: rowsReadFor, name: "deploy-stop", args: deploy.id });
```

- `sessionId` is the session the page's rows were read for. Another session on screen when the call is made refuses it (`session-changed`), so rows read for one session never act on another.
- The host builds the text, `/name args`, and runs it through this device's outbox like a typed command: at most once, and kept sending while the machine cannot be reached (the promise stays pending). No command row is drawn in the chat; the extension's own notices still appear there.
- While the machine holds the command before running it (during a compaction, for example), the page that ran it does not list it among the reader's queued messages, and Stop or Clear queue there does not put it in the reader's composer. Stop and Clear queue drop it like the rest of the queue, and the promise resolves `refused` (`machine-refused`) if it has not resolved yet.
- Only extension commands by their invocation name are run. A built-in (`/new`, `/compact`, even when an extension registers the same name), a skill, a prompt template, a name two extensions share (pi lists them as `name:1`, `name:2`), a name the package did not declare and words with a line break are refused before anything is sent.
- The promise resolves once:

| `kind` | Meaning |
|---|---|
| `ran` | The command's handler returned. `notices` are the `notify` lines it showed the reader while it ran, oldest first; an empty list means it said nothing, not that it succeeded. |
| `waiting` | The machine took the command and no answer came within 10 seconds: the session is compacting, the handler waits on a dialog, or the machine's PI WEB is older. It also means another tab of this browser profile sent the command and heard the machine's answer. Read your own state for what happened. |
| `refused` | Not run. `reason` names why (`not-declared`, `not-extension-command`, `commands-unknown`, `session-changed`, `no-session`, `args-not-one-line`, `not-stored`, `machine-refused`) and `words` say it to the reader. Later releases may add reasons. |
| `unknown` | The machine took the command and its answer was lost. Read your own state. |

The declaration and the checks are a contract the host keeps and shows, not a sandbox: a browser plugin is trusted page code and can already call the host's endpoints with `fetchJson`.

### Writing the draft and sending from a page

A page writes the draft of the session on screen and sends to it as the reader, whether or not the composer is drawn: on a phone the page replaces the chat and the composer is not there, and the session's stored draft is used instead; the reader finds it in the composer on going back.

```ts
const composer = context.composer;
if (composer === undefined) return;
composer.setDraft(transcript);
const sent = await composer.send();
```

- `context.composer` belongs to the machine and session on screen when the context was made. Once another session is on screen, `setDraft`, `insertText` and `send` do nothing and answer `"left"`; `draft()` still reads that session's draft. Use the context each `render` receives.
- `draft()` is the session's draft: the composer's while it shows the session, else the stored one.
- `setDraft(text)` replaces the draft and `insertText(text)` appends to it after a space, as a composer control's `replaceDraft` and `insertText` do. They answer `"written"`, `"left"`, or `"not-stored"` (this browser could not store the draft).
- `send()` sends the session's draft and its attachments and clears them, as the Send button does. `send(text)` sends those words as a message of their own and leaves the draft alone.
- Either goes through this device's outbox like the Send button: at most once, kept sending while the machine cannot be reached, a steer while a turn runs and a follow-up otherwise. Its details show "Sent with <plugin name>" on every device.
- A page's send never runs a command. Words whose first character is `/`, or a `!` shell command, are not sent and answer `"command"`, and the draft is left as it was; run a declared extension command with [`session.runCommand`](#running-a-session-command).
- `send` answers what a composer control's `send()` answers, and `"command"`:

| Answer | Meaning |
|---|---|
| `sent` | The message is written to the outbox and on its way. |
| `empty` | Nothing to send. |
| `left` | Another session is on screen; nothing was sent. |
| `not-stored` | This browser could not store the message, or could not read the draft's attachments it keeps just now; the draft and its attachments stay. |
| `command` | The words would run a command; nothing was sent. |

Later releases may add answers: treat one you do not know as not sent. A file still being attached in the composer, or a send still being written, is waited for first; two sends of the stored draft go one after the other, so a draft goes once.

### Global page context

| Member | Description |
|---|---|
| `machine`, `state`, `host` | As for workspace pages. |
| `terminal.sessions` | The machine's own terminals, in its home folder: `list`, `start`, `close`, `closeAll`, `continue`, `rename`, `connect`. |
| `terminal.open({ terminalId? })` | Show the global Terminal page. |
| `terminal.runInNewTerminal({ title, command })` | Start a shell in the home folder, type the command once the shell has drawn its prompt, and show it. The machine's session daemon types it; an older one leaves it to the page. Resolves once the machine has the command, or the page has typed it, not when it finishes. Rejects after the page has told the reader what became of the command. In the notice row: the machine refused the shell (nothing ran), or gave no answer or a server error (the command may have started; the Terminal page opens, while that machine is still on screen, to look before running it again). In a dialog: the page could not type it (the dialog names the machine and shows the command with a copy key; Open Terminal moves to that machine and shows the shell). |
| `terminal.selectedId`, `terminal.autoStart`, `terminal.select(id)` | The terminal selection. |
| `fleet` | [The fleet](#fleet), the same as the activation context's. Optional. |
| `checkForPiWebUpdates()`, `openUpdateCommandSetting()` | **Host-internal, unstable.** Optional. |

### Fleet

`context.fleet` (on the activation context and the global page context) is every configured machine as this page holds it: the machine list, each machine's reachability, each machine's session board (the one the Navigate page lists), and the host's own navigation to a session. Reads are synchronous snapshots, frozen all the way down and shared by every plugin. Each `onDidChange*` method calls its listener with the new snapshot whenever it changes and returns its unsubscribe function; every subscription is dropped with the plugin.

| Member | Description |
|---|---|
| `machines()` | `{ loaded, machines }`. `loaded` is false until the machine list first answers, so an empty list says nothing before that. |
| `onDidChangeMachines(listener)` | While any listener is subscribed, the host keeps checking every machine's reachability, as the Machines list does. Subscribe while the page is shown. |
| `sessions(machineId)` | `{ machineId, coverage, sessions, error? }`: one machine's session board. |
| `onDidChangeSessions(machineId, listener)` | While any listener is subscribed, the host keeps that machine's board read, and a board that did not answer whole is read again by itself. |
| `refreshSessions(machineId, signal?)` | Read the board whole now. Resolves when the read settles. Aborting the signal rejects the call with the signal's reason, and the read goes on for the host's other readers. A machine not in the machine list is not read: the call resolves at once. |
| `openSession({ machineId, sessionId })` | Open a session through the host's navigation, moving to its machine first, as a tap in Navigate does. Before the machine list first loads, it waits for it, up to 10 seconds. Resolves to a `FleetOpenResult`. |
| `addMachine()`, `renameMachine(id)`, `removeMachine(id)`, `openMachine(id)`, `refreshMachine(id)` | Machine management through the host's own dialogs: add, rename, remove after the host's confirmation, open a remote machine's own PI WEB in a new tab, and check reachability again without selecting the machine. `refreshMachine(id)` is a reader action: for a machine this server reaches, it also ends this server's pause after that machine refused its access token, so the refused token is sent again. Call it when the reader asks, never on a timer. Each returns at once: `"started"`; `"machineUnknown"` (the loaded machine list does not have it); `"machinesUnloaded"` (the machine list has not loaded yet, so nothing is known about the machine; call again once `onDidChangeMachines` reports `loaded`); or `"unsupported"` (no add dialog is installed, or the local machine cannot be removed or opened). |

A machine is `{ id, name, kind, selected, reachability, reason? }`. `reachability` is one of:

| Value | Meaning |
|---|---|
| `checking` | The host is not checking right now, or the machine has not answered since the host started checking it. A state remembered from earlier, in this browser or from before the checks paused, is not an answer: the Machines lists may show it meanwhile, the fleet does not report it. |
| `online` | The machine's PI WEB answered and its session daemon is up. |
| `daemonDown` | The machine's PI WEB answered with a component down or an error; `reason` says which. |
| `offline` | The machine did not answer. |
| `unknown` | An answer came back that cannot say. |

A session is `{ machineId, sessionId, cwd, title, updatedAt, projectId?, workspaceId?, streaming?, archived?, remembered? }`, identified by the pair `machineId` and `sessionId`. `streaming` is present only when the page has heard whether a turn runs. `remembered: true` marks a row that comes from this browser's memory of the board (kept up to a week) for a listing that did not answer now; it may since have been deleted or moved from another device. `coverage` says how much of the board answered:

| `coverage` | Meaning | `sessions` |
|---|---|---|
| `unloaded` | Nobody asked for this board yet. | empty |
| `loading` | Asked, and no answer yet. A lost read is read again by itself. | empty |
| `partial` | Some listings answered; the rest are read again. | what answered, and the `remembered` rows for the rest |
| `complete` | Every listing answered. | the whole board |
| `failed` | The machine refused (`error` says why), or it is not in the machine list. | empty, or the last rows this page held for the machine |

Only `complete` lets a missing session mean "not there". Never show `unloaded`, `loading`, `partial` or `failed` as an empty machine.

`openSession` answers with the app's own verdict once the open settled:

| Result | Meaning |
|---|---|
| `opened` | The session is on screen, including one the machine located in another folder than its board row said. |
| `machineUnknown` | The loaded machine list does not have the machine (removed, or never listed). Nothing opened. |
| `machinesUnloaded` | The machine list had not loaded within 10 seconds, so nothing was decided. Nothing opened; try again once `onDidChangeMachines` reports `loaded`. |
| `machineUnreachable` | The machine did not answer for the session. Nothing opened. |
| `sessionGone` | The machine says the session does not exist. The app shows that. |
| `refused` | The machine refused to say: it asked to sign in, or it forbade the read. The app shows that. |
| `notListed` | The machine cannot locate sessions (an older PI WEB) and its listing lacks this one. That does not make it gone. |
| `folderMissing` | The session exists, but its folder does not, so the app does not open it. |
| `superseded` | Another navigation took over, including an open already under way. |

The session opened is the one the machine's board lists, or else the one the machine locates by id. A plugin keeps its own pins (in browser storage, or its own server storage) as `{ machineId, sessionId }` pairs and opens them through `openSession`. It never builds a URL for a session.

## Host UI

`context.ui` (optional) gives a plugin the host's own pieces, so its surfaces match the built-in ones.

| Member | Description |
|---|---|
| `confirm({ title, message, confirmLabel, tone? })` | Ask on the host's dialog. Resolves `true` only for the confirming key; Cancel, Escape, the backdrop and the back gesture resolve `false`. Name the thing in `title`, the consequence in `message`, and use `tone: "danger"` for what cannot be undone. Optional. |
| `showDialog({ label, content, presentation?, onClose? })` | Present your own dialog over the app's modal layer; returns `{ close() }`. `presentation` is `"overlay"` (default), `"alert"` (the compact card, at most 480px wide) or `"fullscreen"` (edge to edge; the content must draw its own close control). |
| `registerModal({ element, … })` | Register a modal you render yourself with the app's focus and stacking. |
| `renderList(model)` | Draw a status list the way every status page draws it. See [Drawing a status list](#drawing-a-status-list). Optional. |
| `renderButton(button)`, `renderOutput(view)`, `renderMessageField(field)`, `renderExpandableRow(row)` | The host's button, output view, one-line message field and row that opens, each usable on its own. See [Building a row](#building-a-row). Optional. |
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
- An action takes the [button](#building-a-row) fields: `tone: "danger"` and `busy`. A group's `headingAction` is one button at the right of its heading line.
- A row with `expansion: { expanded, onToggle, body }` opens; it is drawn by the element `renderExpandableRow` uses, so a list row and a standalone row are one anatomy.
- The list scrolls as the whole page and draws no scrollbar, like every PI WEB page. Return it as the page's content, not inside a box of its own.

### Building a row

Four components, each usable without the others: inside or outside `renderList`, on a workspace page, a global page, a settings section or a dialog. Each returns a template that draws a host element carrying its own styles; the element's tag name is the host's and may change, so call the function, never write the tag.

| Function | Draws |
|---|---|
| `renderButton({ label, run, primary?, disabled?, tone?, busy? })` | A button the way the host's lists draw theirs. `tone: "danger"` draws danger ink, for what stops or removes something. `busy: true` puts a spinner before the label, disables the button and sets `aria-busy`; the width does not change. At least 36px tall on every pointer (taller when the label wraps); on a coarse pointer its touch target reaches 44px without growing the drawn box, overhanging 4px above and below, so give wrapped rows of buttons a gap of at least 8px. |
| `renderOutput({ label, read, text, words, cutAbove?, size? })` | Monospace text with its own scroll, held at the bottom as the text grows until the reader scrolls up; scrolling back to the bottom holds it again. `read` and `words` work as in a list: no text draws the box with the state's words, and a failed refresh keeps the text under the `stale` line. `text` is drawn as text, never HTML, with terminal escape sequences removed. `cutAbove` is one muted line above the text when you cut it ("Showing the last 8 KiB"). `size: "tail"` (default) is at most 12 lines tall; `"fill"` takes its container's height, for a fullscreen dialog. `label` names the scroll region. The view does not announce changes to a screen reader. |
| `renderMessageField({ label, placeholder, sendLabel?, disabled?, send })` | One line of text and the composer's send key at its far right. Enter sends unless an input method is composing. `send(text)` gets the trimmed text: resolve `true` to clear the field, `false` to keep the words; a rejection keeps them. The key does nothing while the text is empty or a send is in flight; the field stays editable meanwhile. The field never says why words were kept: say it yourself. The draft lives in the element, so it is lost when the element goes away (a row closed, a page left). The field and its key are 36px tall, the height of a button beside them; on a coarse pointer the touch targets of both reach 44px, overhanging 4px above and below. |
| `renderExpandableRow({ title, status?, value?, detail?, expanded, onToggle, body })` | A row that opens. The whole header is one disclosure button with the chevron at its right edge, at least 44px tall. `expanded` is yours: keep which rows are open by your own scope (machine, session, row), so an open row never shows under another session. `body()` is called only while the row is open. |

What a row's body draws lands inside the host's element, so raw markup there gets only the host's base text style. For your own arrangement (a button on the right, two lines), put one custom element of your own in the body and lay the host components out inside its shadow root.

```ts
const row = ui.renderExpandableRow({
  title: "deploy web",
  status: { label: "running", tone: "good" },
  expanded: open.has(key),
  onToggle: () => { toggle(key); host.requestRender(); },
  body: () => html`<deploy-detail .ui=${ui} .deploy=${deploy}></deploy-detail>`,
});
```

All four functions and the list's `expansion`, `headingAction`, `tone` and `busy` arrive in the same release: a host with `ui.renderOutput` draws the list fields too. An older host has none of them and draws list rows flat; say so in a sentence there rather than drawing nothing.

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
| `serverSettings` | A JSON copy of this plugin's private `plugins.<id>.serverSettings` taken at activation (`{}` when none); `undefined` on an older PI WEB that does not supply private settings. See [Plugin settings](#plugin-settings). |
| `logger` | `debug`, `info`, `warn`, `error(message, details?)`, attributed to the plugin in `pi-web logs`. |
| `storage` | [Plugin storage](#storage). |
| `execFile(request)` | [Bounded command execution](#execfile). |
| `ports` | [Host ports](#host-ports). Optional. |
| `events` | [Server facts](#server-facts): `on(kind, listener)`. Undefined on a host that cannot deliver facts. |
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
| `models` | session daemon, for a plugin the owner granted models | Calls, with optional tool calls, to the models named in `plugins.<id>.models`, through this machine's model registry and logins; see [Models](#models). |
| `workspaceCatalog`, `piWebConfig` | web server | **Host-internal, unstable.** Resolve a workspace to its paths; read a project's path-access config. |
| `machinesStorePath`, `localRuntime`, `machineRegistry` | web server (`machineRegistry`: none today) | **Host-internal, unstable.** For the bundled Machines plugin. |

### Models

`ports.models` lets a server half call a model, for example to summarise a reply, draft a commit message or name a session, without ever seeing a key. The owner names the models a plugin may call in the global config, by exact `provider/model-id`:

```json
{ "plugins": { "example": { "models": ["example-provider/small-fast-model"] } } }
```

A plugin without that list, a plugin running in the web server, and a host older than the port get no `models` port. Say so on the plugin's own surface ("Needs plugins.example.models"). A changed list takes effect at the next session-daemon start, and the card says **Restart required** until then.

```ts
interface PluginModelPort {
  list(): Promise<readonly { model: string; name: string | undefined; reasoning: boolean | undefined; state: "ready" | "no-auth" | "unknown-model" | "not-ready" }[]>;
  complete(request: {
    model: string;
    system?: string;
    messages: readonly { role: "user" | "assistant"; text: string }[];
    reasoning?: "off" | "minimal" | "low" | "medium" | "high";
    maxTokens?: number;
    tools?: readonly { name: string; description: string; parameters: Record<string, unknown> }[];
  }, signal: AbortSignal): Promise<PluginModelReply>;
}

type PluginModelReply =
  | {
    kind: "answered";
    text: string;
    stopReason: "stop" | "length" | "toolUse";
    usage: { input: number; output: number; reasoning?: number; costUsd?: number };
    toolCalls?: readonly { name: string; arguments: unknown }[];
    droppedToolCalls?: readonly { name: string; reason: "not-offered" | "unreadable-arguments" }[];
  }
  | { kind: "refused"; reason: "not-granted" | "unknown-model" | "no-auth" | "not-ready" | "busy" | "tools-out-of-bounds" }
  | { kind: "failed"; message: string };
```

- `list()` answers every granted model with whether this machine can call it now: `ready`, `no-auth` (its provider has no login or key here), `unknown-model` (this machine's registry does not know it) or `not-ready` (the session daemon is still starting).
- `complete` never rejects. `refused` means nothing was sent: the model is not in the grant (`not-granted`), not callable now (`unknown-model`, `no-auth`, `not-ready`), the plugin already has two calls in flight (`busy`), or `tools` is outside the bounds in [Tool calls](#tool-calls) (`tools-out-of-bounds`). More reasons may be added: read an unknown one as "nothing was sent". `failed` means the request was not valid (the message says which field), the provider answered with an error, the call was aborted through `signal`, or it ran past 60 seconds.
- The host bounds every call: no images, `maxTokens` 1024 by default and at most 4096, a 60-second deadline, two calls in flight per plugin. `reasoning` defaults to `"off"`, which asks the model not to think.
- `usage.costUsd` is present only when the provider reported a cost.
- The session daemon logs each call with the plugin id, the model, the outcome and the tokens, and counts each plugin's calls and tokens since it started. The plugin's card in **Settings → PI WEB Plugins** shows them, with the cost as reported or "cost not reported".
- The grant is consent, not a security wall. A server plugin is trusted code running inside PI WEB, and a browser half can reach the config API.

#### Tool calls

To get structured output or actions from a model without asking it for JSON in its text, offer it tools. The model answers with calls; your plugin decides what to do with them. Every host with `ports.models` takes `tools`. In the example, `models` is `context.ports.models`, already checked to be present.

```ts
const reply = await models.complete({
  model: "example-provider/small-fast-model",
  messages: [{ role: "user", text: transcriptExcerpt }],
  tools: [{
    name: "name_session",
    description: "Give the session a short title.",
    parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  }],
}, signal);
if (reply.kind === "answered") for (const call of reply.toolCalls ?? []) handle(call.name, call.arguments);
```

- A tool is `{ name, description, parameters }`. `name` matches `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` and is distinct within the request; `description` is at most 1024 characters; `parameters` is a JSON Schema with `type: "object"`, in plain JSON, at most 8192 bytes when written as JSON. At most 8 tools. A request that breaks a bound is refused `tools-out-of-bounds`; a tool that is not shaped like this (for example `parameters` that is not an object schema) fails as an invalid request.
- The host never runs a tool and never calls the model a second time: one `complete` is one answer. `answered.toolCalls` lists the calls the model made, in order, whenever the request offered tools, and is empty when it made none. Text and tool calls may both be present. `stopReason` is `"toolUse"` when the model stopped to have its tools run; only a request that offered tools can see it. An empty `tools` list offers none.
- `arguments` are what the provider parsed from the model's reply, not checked against your schema: validate them before acting. The host guarantees only that `name` is a tool you offered. A call to any other name, or one whose arguments were not a JSON object, is left out of `toolCalls` and listed in `droppedToolCalls` with `reason` `"not-offered"` or `"unreadable-arguments"`. More reasons may be added.
- There are no tool-result messages. To continue after acting on a call, send a new request and describe in the message texts what was called and what came of it.

### Server facts

`events.on(kind, listener)` tells a server half what happened to this machine's sessions, after the session daemon decided it. It returns a function that stops listening.

```ts
activate: (context) => {
  const stopListening = context.events?.on("run.ended", async (fact, signal) => {
    if (fact.outcome === "failed") await notify(`${fact.session.sessionId} failed: ${fact.error ?? "unknown error"}`, signal);
  });
  return { stop: () => { stopListening?.(); } };
}
```

| Kind | Fields besides `kind` | When |
|---|---|---|
| `session.created` | `session`, `reason` | A session exists: `start` for one started from a working directory (the browser, a spawn, a subsession), `new`, `fork` or `clone` for one that replaced another in its runtime. |
| `session.archived`, `session.restored`, `session.deleted` | `session` | The archive changed: archived, restored, or an archived session deleted. |
| `run.started` | `session` | The agent started working. Retries of the same run do not start another. |
| `run.ended` | `session`, `outcome`, `error?` | The run settled: `completed`, `stopped` (the reader's Stop or `/new` cut it), `interrupted` (any other abort, such as its session closing under it) or `failed` (the last reply ended on an error pi did not retry; `error` is its message when pi gave one). |
| `message.accepted`, `message.withdrawn` | `session`, `clientMessageId` | A message a device sent with an id was accepted into the session's inbox, or taken back, cleared or returned by Stop or `/new` before the agent read it. |
| `facts.resumed` | `gap: true` | Web server only: the relay from the session daemon was down, so facts may be missing. It comes before any later fact. |

`session` is `{ machineId: "local", sessionId, cwd, projectId?, workspaceId? }`. A missing `projectId` or `workspaceId` means the daemon could not attribute the directory, not that it has no project.

- Facts are announcements, never hooks: a listener cannot change, delay or refuse anything. Listeners run in parallel and the session does not wait for them.
- Each call gets a signal aborted when the listener settles, at the lifecycle timeout, or when the plugin stops. Await the work that uses it: a listener that returns before its request is sent aborts that request. A listener that throws or rejects is logged and contained.
- A fact may repeat, for example `session.archived` for a session archived again, or `message.withdrawn` twice when Stop races a message being handed to the agent. Treat facts as idempotent.
- When the plugin stops, its listeners are dropped, running ones are aborted, and the host waits for them up to the lifecycle timeout.
- Facts are not stored or replayed: a fact decided while the plugin was off, or before a restart, is gone. Read [`sessionTranscripts`](#host-ports) for history.
- A run still open when the session daemon shuts down ends `interrupted`, or `stopped` if the reader's Stop or `/new` already cut it. Before it stops, the daemon hands that fact to its own plugins and, while the web server is connected, to the relay, waiting at most 2 seconds. A fact whose directory the daemon cannot attribute by then goes out without `projectId` and `workspaceId`.
- A server half the session daemon runs hears facts directly. One the web server runs (`runs: "web"` or `"both"`) hears the same facts relayed from the daemon, only while the web server is connected to it. When the connection comes back, after a session-daemon restart too, the plugin hears `facts.resumed` first; a web plugin that started before the connection was up hears it once the connection comes up. The announcement waits for a `facts.resumed` listener: a plugin that subscribes only after the connection came up, during a slow activation for example, hears it before the next fact. A connection the session daemon stops answering is cut once it misses a ping, within 30 seconds, and counts as down.
- `events` is undefined on a host that cannot deliver facts at all, such as an older PI WEB. A plugin that depends on them says so in `health()`.

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
- No operation or route handler starts after `stop` begins; calls still running are aborted and given up to the lifecycle timeout to settle first. The same holds for [fact listeners](#server-facts).
- Turning the plugin on again calls `activate` again; nothing the earlier activation returned is reused. A process keeps a module it imported for the same revision, so module-level state outlives a toggle: keep per-activation state inside `activate`.
- A `stop` that throws or times out leaves the plugin `failed` in phase `stop`.
- Plugins activate in id order and stop in reverse.

A browser half can rely on these:

- `dispose` runs at most once per `activate`, when the plugin is turned off or its machine stops listing it. Closing or reloading the page does not call it.
- Listeners registered with `on`, `sessions`, `machines` and `fleet` are dropped with the plugin, and the host stops the board reads and reachability checks they kept going.
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

Registration errors appear in **Settings → PI WEB Plugins** and the browser console: invalid plugin or contribution id, duplicate contribution id, unsupported API version, a second claim on a message tag, tool name or code-fence language, a removed contribution kind. Package errors appear on the plugin's card and in `pi-web logs`: an invalid or reserved id, a missing module, an unsafe path, a browser path that does not match the package's directory entries exactly, `runs` without `serverModule`, an unknown host fact, a package over the size limit, a duplicate id.

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
- A server-only entry has no manifest record. A dual entry is listed only while the session daemon runs the same package, settings (private ones included) and revision, and its backend is not unhealthy; `backendRevision` pairs the two halves.
- A remote machine's manifest is served through the gateway, and its modules are rewritten to gateway-scoped URLs under machine-scoped runtime ids.

A file under `browserRoot` is served at `pi-web-plugins/<plugin-id>/<package-relative-path>` under the PI WEB address. Files outside `browserRoot`, including a server module, sources, metadata and dependencies, are not served. `browserRoot: "."` makes almost the whole package public: prefer a narrow output directory, and never place secrets in it. `.js` and `.mjs` are served as JavaScript; JSON, CSS, HTML and SVG with their types; anything else as `application/octet-stream`. PI WEB serves the files that exist in the package; it runs no build and copies no `public/` directory.

Reference assets relative to the module, never by an absolute path:

```js
const iconUrl = new URL("./assets/icon.svg", import.meta.url);
```

A bundled module is one file, so `import.meta.url` is the entry's URL everywhere in it; place assets relative to the entry. Module-relative URLs keep working on remote machines and under a reverse-proxy path prefix; a hard-coded `/pi-web-plugins/...` path does not.
