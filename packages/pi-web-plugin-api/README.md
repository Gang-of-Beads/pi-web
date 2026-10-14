# PI WEB Plugin API

Lightweight browser and server plugin contracts for [PI WEB](https://github.com/Gang-of-Beads/pi-web). This package contains TypeScript declarations and the public runtime constants and helpers, not the web app, session daemon or `node-pty`.

## Install

```sh
npm install --save-dev @gang-of-beads/pi-web-plugin-api@alpha
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

## Compatibility

`0.1.0-alpha.1` contains the declarations shipped by PI WEB `2.202610.6`. Browser plugins declare `apiVersion: 2`; server plugins declare `apiVersion: 1`. The existing `@gang-of-beads/pi-web/plugin-api` and `@gang-of-beads/pi-web/server-plugin-api` entry points remain available.

This is an alpha release. Host-internal members marked unstable are not a supported third-party contract.

See the [API reference](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugin-api.md), [authoring guide](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugin-authoring.md) and [plugin conventions](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugin-conventions.md).

## License

MIT.
