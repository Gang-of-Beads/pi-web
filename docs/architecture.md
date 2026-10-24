# PI WEB architecture

How PI WEB is put together, for contributors. Each section names where to look in the code and the design record that explains why it has its shape. The design records are in [design/](design/README.md).

## What runs where

PI WEB is two server processes and a browser client.

| Piece | Entry point | Owns |
|---|---|---|
| Session daemon | `src/server/sessiond.ts` | pi sessions, run in process through the pi SDK (`daemon/sessions/piSessionService.ts`); terminals; the realtime hub; session status; workspace providers. It is long-lived, so a browser disconnect or a web restart does not stop a running session. |
| Web/API process | `src/server/index.ts`, `src/server/web/app.ts` (Fastify) | the browser client, `/api`, plugin assets under `/pi-web-plugins/`, forwarding to the daemon and to remote machines, machine access. |
| Browser client | `src/client/src` (Lit) | everything the reader sees; it talks only to `/api` and to WebSockets. |
| CLI | `src/cli.ts`, `src/nativeServices/` | `pi-web` commands, and installing the two processes as native services. |

The daemon is reached only by its own web process. `pnpm run dev` runs all three with reload on change (`dev:sessiond`, `dev:web`, `dev:client`). To keep sessions running while the web side reloads, run the daemon without reload (`pnpm run start:sessiond`) beside `dev:web` and `dev:client`; a change to the daemon, its protocol or code only it loads then needs a manual daemon restart. See [Installing PI WEB](install.md) for restart order and daemon ownership.

## Source tree by process

| Directory | Loaded by |
|---|---|
| `src/server/web/` | the web process only: routes, proxies, machines and fleet, machine access, static serving |
| `src/server/daemon/` | the session daemon only: sessions, terminals, realtime hub, status, workspace providers |
| `src/server/shared/` | both: project store, plugin catalog and runtime, the daemon client (`shared/sessiondClient/`) |
| `src/shared/` | server and client: wire types (`apiTypes.ts`), the federated route allowlist (`federatedRoutes.ts`), the interactive card types |
| `src/client/src/` | the browser |
| `pi-web-plugins/` | the plugins bundled with PI WEB (files, git, info, machines, mermaid, terminal, updates, workspaces) |
| `packages/pi-web-plugin-api/` | lightweight plugin declarations and public runtime helpers, without the host application |
| `examples/workspace-provider-plugin/` | an example plugin |

A `web/` module never imports from `daemon/`, or the reverse; code both need lives in `shared/`. `src/server/processOwnership.test.ts` enforces it.

## A request's path

1. The client builds application-relative paths, `api/machines/<id>/…`, and resolves each once at the browser boundary (`resolveAppUrl`). For a machine this browser reaches directly, `directMachineUrl.ts` rewrites the path to that machine's own address.
2. The web process answers what it owns (projects, pins, the session board, plugins, config) and forwards session calls to its daemon (`web/sessionProxyRoutes.ts`, bounded by `web/boundedDaemonRequest.ts`). A remote machine reached through this server is forwarded by `web/machines/machineProxyRoutes.ts`, only for the routes listed in `src/shared/federatedRoutes.ts`.
3. The daemon listens on a Unix socket, `$PI_WEB_DATA_DIR/sessiond.sock` by default (`PI_WEB_SESSIOND_SOCKET`); on Windows the default is a named pipe, `\\.\pipe\pi-web-sessiond-<hash of the data directory>`. It listens on TCP instead when `PI_WEB_SESSIOND_PORT` is set (`shared/sessiondClient/config.ts`).
4. The daemon runs the pi session in process and answers.

## Realtime streams

The client opens four kinds of WebSocket (`client/src/api/sockets.ts`): a session's events, a workspace terminal, a machine terminal, and the machine's announcements. The web process bridges each to its daemon (`web/webSocketBridge.ts`).

- The daemon's hub (`daemon/realtime/sessionEventHub.ts`) numbers the frames of each stream with `seq`, tags them with the daemon instance's `epoch`, and keeps a replay ring.
- The page names its quiet window when it opens a socket (`quiet=`). The daemon sends a quiet socket a heartbeat carrying the stream head, so a page that sees a gap, or hears nothing for the quiet window, asks for the frames after the last one it applied.
- A page that asks for it (`status=delta`) gets status frames as the fields that changed.
- A write the web process makes (projects, pins) nudges the daemon to announce it (`shared/sessiondClient/changeNudge.ts`, `daemon/realtime/changeNudgeRoutes.ts`).

Design: [sync-convergence.md](design/sync-convergence.md), [object-model.md](design/object-model.md), [state-diagram.md](design/state-diagram.md) D5.

## Sending a message

Every operation the machine runs (a message, a take-back, a command, a `!` shell command) goes through a per-device operation log.

- The browser keeps each operation as its own record in its outbox (`pendingOutbox.ts`), numbered for this device (`operationLog.ts`; the device id is stored under `pi-web:device-id`).
- `outboxEngine.ts` sends each session's unanswered operations as one ordered batch (`POST …/sessions/:id/operations/apply`) and sends a batch nobody answered again. A message reads as sent at once; it shows "Sending…" when the machine has not answered within 1.5 s, until it answers, and it never fails for good.
- The daemon applies a batch in order (`daemon/sessions/operationBatch.ts`, `sequenceCursors.ts`), records outcomes in the acceptance ledger (`operationLedger.ts`), and publishes `operation.applied` on the session stream. Accepted messages wait in the session's inbox (`ownedPromptQueue.ts`) until pi takes them.

Design: [message-states.md](design/message-states.md).

## Machines

Each machine is a PI WEB of its own. The machine list lives on the PI WEB you opened (the machines plugin, `pi-web-plugins/machines`), and each remote machine is reached one of two ways:

- **This browser** (the default): the page talks to the machine directly. The machine must have approved this page's origin; it keeps approved origins and pending requests in `web/machineAccess/`, and refuses writes from unapproved cross-site pages.
- **This server**: the web process forwards to the machine (`web/machines/machineProxyRoutes.ts`, `machinePluginProxyRoutes.ts`), for a machine only the server can reach or one behind a token or header gate.

"Update / restart all machines" fans out from the browser for directly reached machines (`client/src/fleetFanOut.ts`) and from the server for the others (`web/updates/fleetRoutes.ts`).

Design: [browser-direct-machines.md](design/browser-direct-machines.md). User guide: [machines.md](machines.md).

## Plugins on both sides

- **Catalog.** `src/server/shared/piWebPluginCatalog.ts` discovers plugins (bundled, installed packages, local roots) and records for each where its server entry runs: `runs: "daemon"` (the default), `"web"` or `"both"`.
- **Server runtime.** Each process builds its own runtime (`shared/plugins/serverPluginRuntime.ts`) for the entries that run there. Operations are called through the runtime; route contributions are mounted by the web process under `/api` and `/api/machines/local` (`web/plugins/serverPluginRouteMount.ts`).
- **Browser.** The page reads the machine's plugin manifest, imports each browser entry from `/pi-web-plugins/…`, and registers its contributions.
- **Live toggles.** Turning a plugin on or off reconciles the web runtime, then the daemon's, and the daemon announces `plugins.changed`; each open page loads or disposes browser entries to match.

Design: [plugin-lifecycle.md](design/plugin-lifecycle.md). Plugin documentation: [plugins.md](plugins.md).

## pi extensions in PI WEB

pi extensions run inside the daemon's pi runtime, as they do in pi's terminal. PI WEB answers `ctx.ui` itself: dialogs become cards in the transcript, a screen declared as an interactive card is drawn natively, any other screen is drawn to lines by the daemon, and statuses, widgets and the working row have web counterparts. PI WEB registers no agent tools of its own.

Design: [extension-ui-counterpart.md](design/extension-ui-counterpart.md), [interactive-card.md](design/interactive-card.md), [pi-insertion-points.md](design/pi-insertion-points.md), [no-builtin-agent-tools.md](design/no-builtin-agent-tools.md).

## Where state lives

| Where | What |
|---|---|
| `$PI_WEB_DATA_DIR` (`~/.pi-web` by default) | PI WEB-managed state, not a config API: `projects.json`, `machines.json` (machines plugin), `machine-access.json`, `session-pins.json`, `session-unread.json`, `archived-sessions.json`, `interrupted-runs.json`, the acceptance ledger `operations.jsonl`, `sequence-cursors.json`, per-session inboxes under `inbox/`, and the daemon socket `sessiond.sock` (on Windows a named pipe named after this directory instead) |
| `$PI_WEB_CONFIG` or `~/.config/pi-web/config.json` | global user and machine configuration ([config.md](config.md)) |
| `<project>/.pi-web/config.json` | project configuration, meant to be committed |
| pi's own directories | pi's sessions, settings and extensions, as pi keeps them |
| the browser's `localStorage` | the outbox, the device id, composer and dialog drafts, the remembered session board, the transcript cache, UI preferences |
| the browser's IndexedDB | composer attachments not sent yet; the attachments of messages in the outbox (database `pi-web-outbox-attachments`), which the outbox record references and which are deleted a minute after the message leaves this browser, or by an hourly sweep an hour after nothing references them |

## Design records

[design/](design/README.md) holds the design records: why each part has its shape, the state machines (`state-diagram.md`), and the bug index. A change that adds a state, a transition or a wire frame adds it to the state diagram in the same commit. Superseded designs are in git history.
