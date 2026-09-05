# Wave 0: the web plugin runtime and the seams it adds

Follows `machines-workspaces-extraction.md` and its owner rulings
(contract-first; no preset shell). Wave 0 changes the plugin contract so that
the two extraction waves have something to stand on. This document names the
shapes before code moves; the implementation amends it in the open.

## What exists today

- Server plugins activate only in sessiond (`sessiond.ts:187`,
  `createServerPluginRuntime`), through a closed eight-field context
  (`server-plugin-api.ts:23-45`) and a closed activation shape
  (`workspaceProvider`, `operations`, `agentFacts`, `start/stop/health`).
- Operations answer JSON only (`ServerPluginOperation` → `JsonValue`,
  8 MiB plugin-backend cap); they cannot express the Range-streaming file
  preview or serve at protocol paths.
- The web process never runs server plugins; it only proxies operations to
  the daemon (`pluginOperationProxyRoutes.ts`).
- Browser contributions cover actions, workspace panels, labels, themes,
  composer slots, settings sections, message renderers, drawer sections —
  no dialog, no main-view ownership, no plugin-owned controllers.

## Seam 1: route contributions (server)

`ServerPluginActivation` gains:

```ts
routes?: readonly ServerPluginRouteContribution[];
```

```ts
export interface ServerPluginRouteContribution {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Core-shaped path template, e.g. /projects/:projectId/workspaces/:workspaceId/file/preview */
  path: string;
  handle(request: ServerPluginRequest, reply: ServerPluginReply, context: { signal: AbortSignal }): Promise<void>;
}
```

`ServerPluginRequest`/`ServerPluginReply` are narrow host-owned interfaces in
`server-plugin-api.ts` — never the framework's types. The reply can answer a
stream: `code`, `headers`, and a `body` of `string | Uint8Array | readable
stream`. This is what makes the preview route expressible; the JSON-only
operation channel stays for what it is good at.

Mounting rules:

- The host owns path resolution. Contributions mount at the declared path
  under `/api` AND under `/api/machines/local` — the dual-registration
  convention is the host's, not the plugin's (`app.ts:250-267`).
- An undeclared route is refused, same law as operations.
- The federated route table (`shared/federatedRoutes.ts`) stays the protocol
  authority; a plugin contributing a protocol path must declare a path the
  table already names. The remote half of the machines proxy keeps forwarding
  by the table, so both ends need the same plugin set — the deployment
  ordering constraint already recorded.

## Seam 2: host port injection (server)

`ServerPluginActivationContext` gains typed optional ports — named fields,
not an untyped record, so no type assertions are needed anywhere:

```ts
export interface ServerPluginHostPorts {
  fleetMachines?: FleetMachinesPort;      // Wave B consumer: fleet routes
  workspaceCatalog?: WorkspaceCatalogPort; // Wave A consumer: file routes
  piWebConfig?: PiWebConfigPort;           // uploads/path-access effective config
}
```

Port interfaces are defined once in `server-plugin-api.ts` (or shared types it
re-exports), and each is optional: a host that cannot supply one leaves it
undefined and the plugin degrades honestly (health reports what is missing).
Core keeps the concrete implementations; plugins receive the port. The
`FleetMachinesPort` shape is the existing `FleetMachines`
(`fleetRoutes.ts:59-65`: `list/localMachine/health/runtime/remoteClient`) —
not `MachineRouteService`.

## Seam 3: the web process hosts server plugins

`createServerPluginRuntime` is already generic (catalog, importer, execFile,
storage root). The web process (`src/server/index.ts` → `web/app.ts`) creates
its own instance:

- Same catalog source the browser manifest already uses (`piWebPluginService`),
  so both processes agree on what is installed.
- Its activation context assembles web-side ports (machines service, the
  `WorkspaceCatalog` implementation, config service).
- Returned route contributions mount on the fastify app with the dual
  prefix; operations keep proxying to the daemon for daemon-owned plugins —
  a plugin activated in the web process serves its operations locally, and
  the proxy stays for daemon-activated ones. Which process runs which plugin
  is a catalog-level declaration (see Seam 5), not inferred.

The provider-runtime handshake keeps a single source of truth: the web
runtime's records feed the web-side `WorkspaceProviderRuntimeReader`
assembly (`app.ts:164-168` today), so a web-activated provider is not
misreported as "unavailable → restart required"
(`piWebPluginLifecycle.ts:86-110`).

## Seam 4: dialog and owned-panel seams (browser)

- `PluginRuntimeContext` gains `openDialog(request)` — the host mounts a
  host-chromed modal, the plugin renders the body, the promise settles with
  the dialog's outcome. This is how MachineDialog moves without the shell
  learning what a machine is.
- Workspace panels become ownable: a plugin's `workspacePanels` entry may
  declare `ownsController: true`, meaning the panel component keeps its own
  state and the core AppState file fields are removed rather than mirrored.
  The core `panels.ts` Files panel and `FileExplorerController` move into the
  workspaces plugin under this rule.
- The identity tuple stays core: panels receive opaque ids and cwd strings
  exactly as today (`composerCwd`, `workspaceFilePreviewPath`).

## Seam 5: where a plugin runs (catalog)

Each plugin's manifest gains an optional `runs: "daemon" | "web" | "both"`
(default `daemon`, preserving today's behavior). The catalog snapshot carries
it; each process activates the plugins addressed to it. Wave A/B set
`both` (server half in web for routes/ports, daemon half for workspace
provider/operations as today).

## Honest absence

Everything Wave A/B moves is a contribution. With pi-web-workspaces absent
there is no project list, no workspace panel, no files view; with
pi-web-machines absent there is no switcher. The shell renders the sections
it was given and states nothing about what it never received — the existing
plugin surface visibility rules carry this; no core fallback UI exists
(owner ruling). Route paths contributed by an absent plugin answer 404.

## Pilot slice (proves every seam in one vertical)

The in-repo bundled skeletons `pi-web-plugins/workspaces/` and
`pi-web-plugins/machines/` are created first (the deployment ordering
constraint wants the intermediate state to exist before core removal). The
pilot moves one thin slice through every new seam:

1. The workspace **file-preview route** re-homes into the workspaces
   skeleton as a route contribution (streaming proof; policy/headers stay
   in shared per the triage).
2. The fleet routes switch from `deps.machines ?? new MachineService()` to
   the injected `FleetMachinesPort` (port-injection proof; core keeps
   constructing the service for now — Wave B moves it).
3. The **machine switcher** moves as a dialog + section pilot (dialog seam
   proof) — wait, no: the pilot keeps to ONE plugin. Final pilot: the
   preview route + the uploads-config port through the workspaces skeleton;
   the dialog seam is proven by a minimal bundled pilot dialog in the
   `updates` plugin (its restart flow already owns a dialog-shaped surface).

## Non-goals

- No hot reload; the runtime stays activate-once, restart-to-change.
- No plugin-to-plugin imports; the tuple and protocol pieces stay core.
- The daemon keeps workspace authority and the provider runtime.
