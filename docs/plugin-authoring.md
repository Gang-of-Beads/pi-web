# Writing a PI WEB plugin

This guide takes a plugin from an empty folder to a published npm package. It follows the plugins maintained alongside PI WEB, which are small, public and meant to be copied. The complete contract is in the [plugin API reference](plugin-api.md); the rules a published plugin follows are in [plugin conventions](plugin-conventions.md).

## Before you start

A PI WEB plugin has a browser half, a server half, or both:

- the **browser half** is an ES module the PI WEB page imports. It adds actions, pages, labels, composer controls, settings sections, themes, and renderers for transcript rows;
- the **server half** is an ES module PI WEB imports into its session daemon on the same machine. It answers named JSON operations from the browser half, keeps state in plugin storage, runs bounded commands, reports background runs, and can own a project's workspaces as a workspace provider.

If you want to give the agent a tool, a command or a hook, you need a Pi extension, not a PI WEB plugin; see [Pi extensions under PI WEB](pi-extensions.md). Many plugins front a Pi extension: the extension does the work, and the plugin draws it in PI WEB.

Plugins are trusted code: they run with the user's permissions and are not sandboxed (see the [trust model](plugins.md#trust-model)).

## Choose a shape

| Shape | When | Template |
|---|---|---|
| Browser only | Everything you need is in the page: a renderer for a tool or message, a theme pack, a page that reads workspace files. | [pi-web-workflows](https://github.com/Gang-of-Beads/pi-web-workflows) |
| Browser and server | The page needs something only the machine has: files outside the workspace, a secret, durable state, a background count. | [pi-web-goals](https://github.com/Gang-of-Beads/pi-web-goals) |
| Workspace provider | You decide what a project's workspaces are (another version-control system, a container per branch). | [`examples/workspace-provider-plugin`](../examples/workspace-provider-plugin/) |

- **pi-web-workflows** contributes one `toolRenderer` that draws the pi-dynamic-workflows `workflow` tool as a live card. It has no server half, so installing it needs only a page reload.
- **pi-web-goals** has a browser half with a Goals page (`workspacePanels`) and `messageRenderers` for goal events, and a server half that answers one operation, `goals.list`, by reading the project's goal files. It declares an `agentFacts` surface so the page shows only where pi-goal's tools are loaded.
- **examples/workspace-provider-plugin**, in this repository and in the published PI WEB package, claims projects that carry a marker file, publishes non-secret metadata, and answers a `summary` backend request.

PI WEB's own bundled plugins under [`pi-web-plugins/`](../pi-web-plugins/) use the same contract. `info` is the smallest (an action, a workspace label and a workspace panel); `git` is the production workspace provider. They are built by PI WEB's own build, so copy their code, not their packaging.

## Create the package

```json
{
  "name": "@your-scope/pi-web-example",
  "version": "0.1.0",
  "description": "PI WEB plugin that …",
  "license": "MIT",
  "type": "module",
  "keywords": ["pi-package", "pi-web", "pi-web-plugin"],
  "repository": { "type": "git", "url": "git+https://github.com/you/pi-web-example.git" },
  "engines": { "node": ">=22.19.0" },
  "files": ["dist", "README.md", "LICENSE", "CHANGELOG.md"],
  "publishConfig": { "access": "public" },
  "piWeb": {
    "plugins": [
      {
        "id": "example",
        "browserRoot": "dist/browser",
        "module": "dist/browser/pi-web-plugin.js",
        "serverModule": "dist/server-plugin.js"
      }
    ]
  },
  "scripts": {
    "build": "node build.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run typecheck && npm test && npm run build && git diff --exit-code -- dist"
  },
  "devDependencies": {
    "@gang-of-beads/pi-web": "^2.202610.5",
    "esbuild": "^0.28.2",
    "lit": "^3.3.3",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
```

- `keywords` with `pi-package` makes the package discoverable as a Pi package.
- `"type": "module"` lets the server half be a `.js` file Node imports as an ES module.
- `browserRoot` is the directory PI WEB serves to the browser. Keep the server bundle outside it.
- `@gang-of-beads/pi-web` is a development dependency for its type declarations only. Add an `.npmrc` with `ignore-scripts=true` so installing it does not build its native terminal module.

The metadata fields and their rules are in [Package metadata](plugin-api.md#package-metadata).

## Pick an id

The plugin id matches `^[a-z][a-z0-9.-]*$`; `core` and ids starting with `machine.` are reserved. The id is permanent: users' `plugins.<id>` config, shortcut preferences and deep links are keyed by it. When a plugin moves (from bundled to npm, from one repository to another), keep its id; the plugins that moved out of PI WEB kept theirs, so existing config still applies.

Only one package can provide an id on a machine; the first one found wins (see [discovery order](plugins.md#where-pi-web-finds-plugins)).

## Write the browser half

```ts
import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Example",
  activate: (context) => {
    const { html, svg, ui, runtimePluginId } = context;
    const unsubscribe = context.on?.("session-activity-settled", () => { /* read again */ });

    return {
      contributions: {
        actions: [{
          id: "open",
          title: "Open Example",
          run: (runtime) => { runtime.selectWorkspaceTool(`${runtimePluginId}:example`); },
        }],
        workspacePanels: [{
          id: "example",
          title: "Example",
          icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"></circle></svg>`,
          render: (panel) => ui?.renderList === undefined
            ? html`<p class="muted">This page needs a newer PI WEB.</p>`
            : ui.renderList({ read: "ready", words: { empty: `Nothing in ${panel.workspace.label} yet.`, reading: "Reading…", failed: "Could not read.", stale: "Could not refresh." }, groups: [] }),
        }],
      },
      dispose: () => { unsubscribe?.(); },
    };
  },
};

export default plugin;
```

- `activate` is synchronous and cheap. Return the contributions; start reads from `render`, `onInvalidate`, lifecycle events or user actions.
- Release in `dispose` everything you started outside your contributions: timers, polling, sockets, listeners on `window` or `document`, requests in flight.
- Use `pluginId` to recognise your own workspaces (`workspace.provider.pluginId === pluginId`) and `runtimePluginId` to build qualified ids for `selectWorkspaceTool` and `openPage`.
- Optional members (`on`, `ui`, `callOperation`, `ui.renderList`) are absent on older hosts. Check before calling, and say what the reader needs to do.
- Define custom elements only when the name is free (`if (!customElements.get(tag)) customElements.define(tag, Element)`), because a remote machine's copy of your plugin can load into the same page. See [machine-specific plugins](plugin-api.md#machine-specific-plugins).

## Write the server half

```ts
import type { PiWebServerPlugin } from "@gang-of-beads/pi-web/server-plugin-api";

const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Example",
  activate: (context) => ({
    operations: {
      "items.list": async (input, { signal }) => {
        const stored = await context.storage.read("items");
        return { items: Array.isArray(stored) ? stored : [] };
      },
    },
    stop: async () => { /* release what activate or start acquired */ },
  }),
};

export default plugin;
```

- Name operations `<noun>.<verb>`. Validate `input`: it comes from the browser.
- Keep state in `context.storage`, which is per plugin and survives restarts. `read` answers `undefined` for a key never written: that means "nothing stored", not "empty".
- Run programs with `context.execFile`, passing the signal of the callback you are in; the host bounds time and output.
- Forward every signal to the work it bounds. Signals end with their call; release long-lived resources in `stop`.
- Declare `agentFacts.surfaces` when a page fronts an extension's tools, and `backgroundWork` with `agentFacts.workPaths` when the extension runs work after its turn ends (as pi-web-subagents and pi-web-background-runs do).

The server half runs inside the session daemon and shares its event loop. Never block it: no synchronous loops over large inputs, no synchronous file reads of unbounded size.

## Call the server half from the browser

Call your own operations with `context.callOperation(name, input)`. The host builds the URL, sends the call to the machine this copy of the plugin belongs to, and rejects the promise when the server refuses. A workspace provider's browser half calls its provider with `context.backend.request(operation, input)` instead. A plugin never builds a PI WEB URL; see [application URLs](plugin-conventions.md#application-urls).

## Bundle

PI WEB imports each entry as-is: the page has no import map, and the daemon loads the server half with Node's own loader. Bundle each half into one self-contained ES module with its dependencies inlined, so the package needs no runtime dependencies. This is pi-web-goals' `build.mjs`:

```js
import { rm } from "node:fs/promises";
import * as esbuild from "esbuild";

await rm("dist", { recursive: true, force: true });
const shared = { bundle: true, format: "esm", target: "es2022", legalComments: "eof", logLevel: "info" };
await esbuild.build({ ...shared, entryPoints: ["src/pi-web-plugin.ts"], outfile: "dist/browser/pi-web-plugin.js", platform: "browser" });
await esbuild.build({ ...shared, entryPoints: ["src/server-plugin.ts"], outfile: "dist/server-plugin.js", platform: "node" });
```

Commit `dist/`: a `git:` install runs no build, so the committed bundle is what users load. The `check` script fails when `dist/` is out of date.

Ship assets inside `browserRoot` and reference them relative to the module (`new URL("./icon.svg", import.meta.url)`); see [browser assets](plugin-api.md#manifest-and-browser-assets).

## Develop locally

Link the working copy into PI WEB's local plugin directory under the plugin's id:

```bash
npm run build
mkdir -p ~/.pi-web/plugins
ln -s "$PWD" ~/.pi-web/plugins/example
```

Use `$PI_WEB_DATA_DIR/plugins` when `PI_WEB_DATA_DIR` is set. After a change, rebuild, then:

- browser half only: reload the PI WEB tab (hard-reload if the page still holds the old module);
- server half: restart the session daemon, then reload the tab.

Watch for problems in **Settings → PI WEB plugins** (the plugin's card, its state and diagnostics), in the browser console, and in `pi-web logs`. `pi-web-plugins/manifest.json` under the PI WEB address shows what the page is offered.

A local plugin with the same id as an installed package wins over it, which is how you test a change to a plugin you also have installed.

## Test

Unit-test the pure parts of the plugin (parsers, list models, the operation handlers) with Vitest; the reference plugins use happy-dom for the browser half. Then check the plugin in a running PI WEB, on a desktop window and on a phone-sized one (393×850 with a coarse pointer, in the browser's device mode).

Before you publish, turn the plugin on and off on a running PI WEB and check each [lifecycle guarantee](plugin-api.md#lifecycle-guarantees). Open two pages on the same machine (two tabs, or a desktop and a phone), keep the developer tools open, and follow `pi-web logs`. While you check, have `activate` and `dispose` log one line each in the browser, and `activate`, `start` and `stop` one line each in the server half. A plugin that supplies a workspace provider applies a toggle at the next session-daemon start instead; check it across that restart.

1. Turn the plugin on in **Settings → PI WEB plugins**. Its pages, actions and sections appear on both pages without a reload, and each page logs `activate` once. The server half logs `activate` and `start` once, before the save answers.
2. Call one of its operations from a page's developer console with the input it expects. It answers `200`:

   ```js
   await fetch("api/plugins/<plugin-id>/<operation>", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }).then((response) => response.status);
   ```

3. Start an operation that waits on its signal, and turn the plugin off while it runs. The call's signal aborts and the call ends, then `stop` logs once and the log says `server plugin turned off`. Nothing the plugin handles logs after `stop` begins.
4. Call the operation again. It answers `409` with `code: "plugin-not-active"`.
5. Look at both pages. The plugin's contributions are gone, nothing reloaded (text typed in the composer is still there), each page logged `dispose` once, and the Network panel shows no more requests from the plugin.
6. Turn it on again. `activate` (and `start`) log again, the contributions come back, and what the plugin keeps inside `activate` starts over.
7. Set one page offline (developer tools → Network → Offline), toggle the plugin on the other page, and set the first page online again. Once it reconnects, it shows what the other page shows.
8. With a build whose `stop` throws, or waits past the 10-second lifecycle timeout, turn the plugin off. Its card reads **Failed** with the error, the log says `server plugin stop failed`, and its operations answer `409`.
9. With a build whose browser `activate` throws, reload a page. Nothing of the plugin is drawn, and its card says "Did not load in this browser" with the reason.
10. Turn the plugin off, then restart the session daemon. `stop` does not log a second time.

## Publish

Publish under your own npm scope. The plugins maintained alongside PI WEB release from a tag, with a GitHub Actions workflow (see pi-web-goals' `.github/workflows/publish.yml`):

1. Update `version` in `package.json` and `package-lock.json`, give `CHANGELOG.md` a `## <version>` section, commit, and push a matching `v<version>` tag.
2. The workflow runs `npm run check`, refuses a tag that does not match `package.json`, publishes to npm, and creates the GitHub Release from that CHANGELOG section. A version already on npm is skipped, so rerunning a tag only repairs the release.
3. The first release of a new package cannot use trusted publishing. While the repository has an `NPM_TOKEN` secret (a stage-only token), the workflow runs `npm stage publish`, and a maintainer approves the staged version on npmjs.com with two-factor authentication.
4. After the first release, configure trusted publishing (OIDC) on npmjs.com for the repository and the workflow file, and remove the secret. The workflow then runs `npm publish --provenance`. Keep the workflow's file name: the trusted publisher is bound to it.

Staged and trusted publishing need npm 11.15 or newer; the workflow updates npm before publishing. A CI workflow (`.github/workflows/ci.yml`) runs `npm run check` on pushes to the main branch and on pull requests.

Users install the plugin with `pi install npm:@your-scope/pi-web-example`, or follow your main branch with `pi install git:github.com/you/pi-web-example`.

## Document

Give the README these sections, as the reference plugins do:

- **Requirements**: the minimum PI WEB version the plugin needs, and the Pi extension it fronts, if any;
- **Install**: the `pi install npm:…` and `git:…` sources, and whether a session-daemon restart is needed;
- **How it works**: what each half does, what it reads and writes, every command it runs, and every network service it contacts;
- **Development**, **Contributing**, **Releasing** and **License**.

## Get listed

The [Packages](plugins.md#packages) table lists packages maintained alongside PI WEB. To propose yours, open a pull request against PI WEB that adds its row; the criteria are in [Plugin conventions: listing a package](plugin-conventions.md#listing-a-package).
