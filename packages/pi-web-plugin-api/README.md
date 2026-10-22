# PI WEB Plugin API

Lightweight browser and server plugin contracts for [PI WEB](https://github.com/Gang-of-Beads/pi-web). This package contains TypeScript declarations and the public runtime constants and helpers, not the web app, session daemon or `node-pty`.

## Install

```sh
npm install --save-dev @gang-of-beads/pi-web-plugin-api
```

Browser plugins also install `lit@^3`: the browser declarations use Lit's template and style types, including when rendering through the host's `context.html`. Server-only plugins do not need Lit; their declaration dependencies are included.

## Use

```ts
import type { PiWebPlugin } from "@gang-of-beads/pi-web-plugin-api/plugin-api";
import type { PiWebServerPlugin } from "@gang-of-beads/pi-web-plugin-api/server-plugin-api";
```

Public runtime exports use the same entry points:

```ts
import { CORE_STATUS_FLAGS } from "@gang-of-beads/pi-web-plugin-api/plugin-api";
import { parsePiWebRuntimeResponse } from "@gang-of-beads/pi-web-plugin-api/server-plugin-api";
```

Bundle runtime imports into each plugin half: PI WEB loads plugin modules as they are, and the browser page has no import map. Type-only imports are erased during compilation.

Members newer than a host are absent on it: check optional context members such as `context.fleet`, `context.sessions` and `context.machines` before use, so the plugin still loads on an older PI WEB.

## Compatibility

`0.1.0-alpha.6` contains the declarations shipped by PI WEB `2.202610.17`, adding to alpha.5: a checkbox drawn the way Settings draws one (`context.ui.renderToggle`); a list row that ends in its own button (`action`) or checkbox (`toggle`), which plugins detect through `renderToggle`; `SERVICE_RESTART_NOTES`, the sentences PI WEB shows where a machine's services offer no restart, with each status component's `serviceRestart` state and the session daemon's `ownService`; the Pi package updates in the PI WEB status (`piPackages`); `isStopping` on a session's status while a stopped run is still ending; and the capability and refusal codes for joining a session that is still being created, start commands typed by the machine, and the access token. Browser plugins declare `apiVersion: 2`; server plugins declare `apiVersion: 1`.

`0.1.0-alpha.5` contains the declarations shipped by PI WEB `2.202610.15`, adding to alpha.4: fleet pages (`scope: "fleet"`, `context.fleet`); session facts for server plugins (`context.events.on`); granted model calls with tool calls (`context.ports.models`, only for models listed under `plugins.<id>.models`); message buttons (`messageActions`); composer controls with live state that can press Send; a workspace page's `context.composer` to write the draft and send for the session on screen; the shared components in `context.ui` (button, output view, message field, expandable list rows); declared `sessionCommands` run through `context.session.runCommand`; and `askedBy` on run-end facts. Browser plugins declare `apiVersion: 2`; server plugins declare `apiVersion: 1`. The existing `@gang-of-beads/pi-web/plugin-api` and `@gang-of-beads/pi-web/server-plugin-api` entry points remain available.

This is an alpha release. Host-internal members marked unstable are not a supported third-party contract.

See the [API reference](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugin-api.md), [authoring guide](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugin-authoring.md) and [plugin conventions](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugin-conventions.md).

## License

MIT.
