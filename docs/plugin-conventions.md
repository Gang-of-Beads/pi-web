# PI WEB plugin conventions

These are the rules a published PI WEB plugin follows, and what reviewers check before a package is listed in [Packages](plugins.md#packages). PI WEB's own bundled plugins are held to the same rules. **MUST** and **MUST NOT** are requirements; **SHOULD** and **SHOULD NOT** are strong recommendations you may depart from with a reason stated in your README.

The contract itself is in the [plugin API reference](plugin-api.md); the walkthrough is the [plugin authoring guide](plugin-authoring.md).

## Naming

- The repository SHOULD be named `pi-web-<name>` and the npm package `@<your-scope>/pi-web-<name>`. Packages maintained alongside PI WEB use `@gang-of-beads/pi-web-<name>`.
- The plugin id SHOULD be `<name>`. It MUST match `^[a-z][a-z0-9.-]*$`, MUST NOT be `core` or start with `machine.`, and MUST NOT change once released: config, shortcut preferences and deep links are keyed by it.
- Contribution ids SHOULD be dotted lowercase and say where they live: `workspace.<name>` for a project page, `global.<name>` for a global page.
- Operation names SHOULD be `<noun>.<verb>`, such as `goals.list` or `offer.answer`.

## Imports and boundaries

PI WEB checks its bundled plugins for these in `pi-web-plugins/pluginPublicApi.test.ts`. A published plugin:

- MUST import PI WEB only from `@gang-of-beads/pi-web/plugin-api` and `@gang-of-beads/pi-web/server-plugin-api`, with `import type` for types. It MUST NOT import `@gang-of-beads/pi-web/dist/…`, `…/src/…` or any other subpath.
- MUST NOT call PI WEB with `fetch`, `XMLHttpRequest` or `WebSocket`, and MUST NOT contain PI WEB application paths (`api/…`, `pi-web-plugins/…`). Use the context helpers.
- MUST NOT import `fastify` or reach into PI WEB's server.
- SHOULD run programs through `context.execFile` rather than `node:child_process`; the host bounds and attributes those runs. A process a plugin starts itself MUST be stopped in `stop`.
- MAY call a third-party service the user configured (the [Voice plugin](https://github.com/Gang-of-Beads/pi-web-voice#readme) calls the speech service it is configured with), and MUST disclose it in the README.

## Application URLs

PI WEB can be served at the origin root or under a reverse-proxy path prefix, and a page can show several machines through one gateway. A plugin that spells a URL breaks one of these.

- A browser half MUST reach its own server half with `context.callOperation`, a workspace provider with `context.backend.request`, and workspace files with the `files` helper, including `files.previewUrl` for a file the browser loads directly.
- A plugin's own assets MUST be referenced relative to the module: `new URL("./icon.svg", import.meta.url)`. A leading-slash `/pi-web-plugins/…` path MUST NOT be used.
- A plugin MUST NOT build a URL from `pluginId` or `runtimePluginId`.

## UI

- Colours MUST come from the `--pi-*` design tokens or from the host's styles (`ui.surfaceStyles`, `ui.listStyles`, `ui.workspacePanelStyles`, `ui.textStyles`), so every theme applies. Icons SHOULD be SVG with `currentColor`.
- Every interactive target MUST be at least 44px high on a coarse pointer (`var(--pi-control-height-touch)`). Check every page at 393×850 with a coarse pointer as well as on a desktop window.
- Tiles in a grid MUST share a height, and titles SHOULD be clamped to a fixed number of lines, so a page does not reflow with its content.
- A plugin MUST ask for confirmation with `ui.confirm`, never `window.confirm`, and SHOULD present its own dialogs with `ui.showDialog`.
- A page that lists things SHOULD draw them with `ui.renderList`.
- A read has three states (reading, ready, failed) and a page MUST show which one it is in. "Not read yet" and "could not read" MUST NOT be drawn as "none".
- A failed read MUST be retried, keeping what is known for the same key on screen (`ui.readFailure` gives the delay). A page MUST NOT show an error the reader cannot act on; it says at most that it is reconnecting, and shows a refusal the server stated.
- Cached data MUST carry the scope it was read for (machine, project, workspace, session, as applicable) and MUST NOT be drawn or acted on when that scope is no longer the one on screen.
- A composer control for a capability the machine lacks SHOULD be absent (`available: false`); a control that cannot act right now SHOULD be disabled with a reason (`enabled: false`, `disabledReason`).
- A page SHOULD put its controls in `toolbar` and draw no title row of its own; PI WEB's app bar names the page.

## Lifecycle

- `activate` MUST be synchronous in the browser and cheap in both halves; expensive work starts from callbacks and user actions.
- Everything a browser half starts outside its contributions (timers, polling, sockets, global listeners, requests) MUST be released in `dispose`; everything a server half acquires MUST be released in `stop`.
- Every signal the host passes MUST be honoured and forwarded to the work it bounds. A signal MUST NOT be kept as a plugin-lifetime notification.
- State that belongs to one activation MUST live inside `activate`, not at module level; a module outlives a toggle.
- Custom elements MUST be defined only when the name is free, and MUST receive per-machine data through properties, not module or static state.

## Server half

- Operation inputs MUST be validated; results MUST be JSON.
- Work MUST be bounded in time and size, and MUST NOT block the event loop it shares with every session on the machine.
- Secrets MUST NOT appear in `publicMetadata`, operation results, removal wording, health details or logs.
- Durable state SHOULD live in `context.storage`. `undefined` from `storage.read` MUST be treated as "nothing stored", not as "empty".
- A server half SHOULD report a missing host port or missing configuration through `health()` rather than failing activation.

## Compatibility

- The README MUST state the minimum PI WEB version the plugin needs.
- Optional host members MUST be feature-detected; when one is missing, the plugin SHOULD degrade with a sentence the reader can act on ("This page needs a newer PI WEB").
- A plugin MUST NOT rely on members marked host-internal in the API reference or on `state` fields the declarations do not name.
- Payloads from Pi extensions (`details`, `payload`, `status`) MUST be read defensively.

## Security and privacy

- A plugin is trusted code and MUST NOT do more than its README says. Every command it runs, every file outside the workspace it reads or writes, and every network service it contacts MUST be disclosed in the README.
- A plugin MUST NOT send telemetry or contact any service its README does not name.
- Files under `browserRoot` are public to every page; nothing secret may be placed there.
- Plugin settings reach every page through the browser manifest. A secret a browser half must not see SHOULD be kept by the server half, as the Voice plugin keeps its speech-service key and hands the page a short-lived token.

## Packaging and release

- The package MUST be an ES module package (`"type": "module"`) with `piWeb.plugins` metadata, and SHOULD carry the keywords `pi-package`, `pi-web` and `pi-web-plugin`.
- Each half MUST be one self-contained ES module with its dependencies bundled; the package SHOULD have no runtime dependencies.
- `browserRoot` SHOULD be a narrow output directory that does not contain the server half.
- A package installable with `git:` MUST commit its built `dist/`, and its CI SHOULD fail when `dist/` is out of date.
- A release SHOULD be published from a `v<version>` tag matching `package.json`, with a CHANGELOG section for the version, and with npm provenance.
- The README SHOULD have the sections Requirements, Install, How it works, Development, Contributing, Releasing and License.

## Listing a package

A package is listed in the [Packages](plugins.md#packages) table by a pull request against PI WEB that adds its row. The maintainers review it against these criteria:

- public source under an OSI-approved license;
- published on npm, or installable with `git:` with a committed `dist/`;
- the `pi-package` keyword, and a README with Requirements and Install;
- the conventions on this page, including the [lifecycle check](plugin-authoring.md#test);
- tagged releases with a CHANGELOG;
- an issue tracker that is answered.
