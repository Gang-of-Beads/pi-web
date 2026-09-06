---
"pi-web": patch
---

Machines management routes move into the machines plugin.

The bundled machines plugin now serves the whole `/api/machines` management surface (list, add, get, patch, delete, health, runtime) over its own service, while the core keeps only the proxy and fleet consumers, fed by the plugin-registered machine registry. A host that already owns a machine registry can hand it to the plugin through the new `machineRegistry` port so both sides share one source; without it the plugin builds its own from the store-path and local-runtime ports, and a host with none of those sees the plugin report unhealthy instead of half-answering. Route contributions gain `PATCH`, mounted alongside the existing verbs, and the server plugin contract ships `localRuntime`, the runtime parser, and the remote request error class so plugins parse remote runtimes themselves. A host without the machines plugin keeps the fleet honest with a local-machine fallback registry.
