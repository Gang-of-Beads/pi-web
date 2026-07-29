# PI WEB Safe Tunnel

PI WEB includes a local Safe Tunnel UI and server-side application service for registering this PI WEB with PI WEB Safe Tunnels.

## PI WEB-owned state and credentials

The PI WEB web/API process now owns Safe Tunnel login, machine registration, tunnel-configuration access, and durable local state. The browser still uses the existing `/api/safe-tunnel/*` routes and operation polling, but it never receives machine tokens, connector access tokens, or generated frp configuration.

State is stored beneath PI WEB's persistent data directory:

```text
$PI_WEB_DATA_DIR/safe-tunnel/config.json
```

`PI_WEB_DATA_DIR` defaults to `~/.pi-web`. On POSIX systems PI WEB enforces `0700` on the Safe Tunnel directory and `0600` on the atomically replaced state file. The file contains:

- desired `enabled` or `disabled` intent;
- the local PI WEB target;
- an optional advanced `frpc` path override that bypasses PI WEB's managed binary;
- private machine id/token and Control API location;
- non-secret machine slug/public URL metadata.

Desired intent is independent from observed runtime state. Start persists `enabled` before process preparation; disable attempts to persist `disabled` before cancelling retries and stopping the owned child. A state-write failure is reported but does not leave the exact owned child running. Web/API shutdown stops the child without changing enabled intent. On the next web/API startup, PI WEB rereads that intent and re-arms direct supervision automatically. A stopped or failed runtime therefore does not silently erase what the user requested.

On first read, if PI WEB state is absent and the former connector config exists (normally `~/.config/pi-web-tunnel/config.json`), PI WEB imports it into the private state file with **disabled** intent. The legacy source is left in place for safe rollback; PI WEB state is authoritative afterward.

## Login and Control API boundary

`POST /api/safe-tunnel/login` starts a PI WEB-owned tracked operation. PI WEB's application service:

1. starts hosted device authorization;
2. exposes only the approval URL and user code through operation status;
3. polls at the server-provided interval until approval or expiry;
4. registers this machine with the short-lived connector access token;
5. atomically persists the returned machine credential; and
6. exposes only the public URL and redacted registration metadata to the browser.

The concrete HTTP adapter alone knows Control API paths, Bearer headers, request/response DTOs, and HTTP statuses. It strictly parses success data and translates transport, authentication, rejection, rate-limit, service, and malformed-response failures into stable PI WEB errors without retaining provider bodies or token-bearing causes.

The same PI WEB-owned boundary fetches per-machine tunnel configuration, applies the private local PI WEB URL to the returned TOML, and records machine heartbeats. The direct supervisor and runtime reconciler consume only normalized application results; process/timer code does not know Control API paths, Bearer headers, or external response DTOs.

## Managed frpc acquisition

On start, PI WEB uses an explicitly configured advanced `frpc` path when one exists. Otherwise it obtains `frpc` through its application-owned binary manager. The package ships a static manifest rather than querying a release API. The current manifest pins:

- frp version `0.69.1`;
- the `linux` / `arm64` release archive and exact `frpc` entry;
- the extracted executable size; and
- SHA-256 `f93e758ea21099a8ac6b65791d1113e86ccb06bab03cc41575613726e375322d`.

Other platform/architecture pairs fail explicitly before any download and can use the advanced path override. A target becomes supported only when its release entry and independently pinned executable digest are added to the shipped manifest.

The downloader performs one bounded, timed HTTPS fetch and retains no response body, URL, redirect details, or Fetch cause in application errors. Archive handling expands a bounded gzip fixture in memory, parses tar headers/checksums, and copies only the exact expected regular-file entry; it never extracts arbitrary archive paths to disk. PI WEB verifies the executable's size and SHA-256 before installation.

Verified binaries live under:

```text
$PI_WEB_DATA_DIR/safe-tunnel/frpc/versions/<version>/<platform>-<architecture>/frpc[.exe]
```

Installation writes and syncs a same-directory private temporary file, then renames it into place. On POSIX, managed directories and executables are restricted to `0700`. PI WEB re-hashes an existing desired binary before every use. When a future manifest changes the desired version, prior manifest entries remain eligible in preferred order: if acquiring the update fails, PI WEB uses an already installed prior binary only after its pinned size and digest verify. Corrupt, unknown, or unlisted files are never fallbacks. Browser-visible managed-acquisition diagnostics contain only the version, target, outcome, and stable failure code—not artifact URLs, hashes, filesystem paths, provider bodies, or transport causes.

Tests exercise the concrete HTTP downloader through loopback responses, generated byte archives, and temporary install directories; they make no request to the pinned public URL.

## Direct frpc supervision

Browser start/status/stop no longer invokes the connector command. PI WEB fetches the normalized tunnel configuration, selects the verified managed executable (or the explicit advanced override), atomically writes `$PI_WEB_DATA_DIR/safe-tunnel/frpc.toml`, and launches `frpc -c <private-config>` directly. On POSIX the runtime directory is `0700` and generated TOML plus `frpc.log` are `0600`; config replacement uses a synced same-directory temporary file followed by rename. Disable and web/API shutdown remove the generated TOML after process cleanup.

The supervisor stores the exact child handle returned by its launcher. It never writes a PID file and never signals a numeric PID read from disk, so stale state cannot target an unrelated process. Disable and shutdown abort in-flight tunnel-config preparation, cancel restart/stability timers, stop only that handle with `SIGTERM`, escalate that same handle to `SIGKILL` after a bounded grace period, wait for bounded completion, and detach the listeners owned for that child. Fastify's close lifecycle invokes shutdown, and the web entrypoint closes Fastify on `SIGINT`/`SIGTERM`. Shutdown deliberately preserves enabled intent.

An unexpected exit or launch/preparation failure retries with exponential delays from one second up to 30 seconds. A child must run for 60 seconds before the failure count resets. Each retry obtains current normalized tunnel config, reselects/reverifies the executable, and atomically replaces the private TOML; there is no busy loop. Runtime and operation diagnostics retain only stable errors, public/local targets, version/target/outcome, exit code/signal, and capped sanitized output—not executable paths, artifact URLs/hashes, generated TOML, provider bodies, or transport causes.

## Startup reconciliation and heartbeats

Fastify startup explicitly invokes PI WEB's Safe Tunnel runtime reconciler. Disabled intent remains stopped. Enabled intent with private machine credentials re-arms the direct supervisor with the persisted advanced override, or managed `frpc` when no override exists. A state-read failure retries with exponential delays from one second to a 30-second cap; it does not expose filesystem causes. Re-registration while intent remains enabled triggers another reconciliation so rejected credentials can be replaced without restarting PI WEB.

While supervision is armed—whether the exact child is running or the supervisor is between bounded child retries—PI WEB sends normalized `running`, `starting`, or `error` heartbeats. A successful Control API response supplies the next interval, which PI WEB clamps to a safe range of five seconds through five minutes. Transport, service, malformed-response, and rate-limit failures retry from one second through a 30-second cap without stopping an otherwise useful tunnel or entering a busy loop.

If the Control API rejects the machine credential, including after hosted revocation, PI WEB treats that as terminal for the current credential: it cancels heartbeat/reconciliation timers, stops only its exact owned child, keeps enabled intent intact, and reports that re-registration is required. A successful replacement registration resumes reconciliation. Disable and web/API shutdown abort and await an in-flight heartbeat before stopping/shutting down the child runtime, so no late heartbeat can recreate timer work during cleanup.

The `pi-web-tunnel` workspaces, command-discovery module, npm installer, and old PID-file CLI remain in the source tree only for legacy development/recovery until the dedicated cleanup leg. PI WEB's browser runtime does not invoke or configure them, and users should not install a separate connector service.

## Local browser API

The browser-facing routes remain:

| Method/path | Purpose |
| --- | --- |
| `GET /api/safe-tunnel/status` | Returns redacted PI WEB-owned registration, persisted desired state, reconciled direct-supervisor status/log tail, bounded heartbeat/recovery errors, and an active operation when present. |
| `POST /api/safe-tunnel/login` | Starts PI WEB-owned device authorization and machine registration. |
| `GET /api/safe-tunnel/operations/:operationId` | Polls a tracked login/start operation. |
| `POST /api/safe-tunnel/start` | Persists enabled intent, prepares private config and verified `frpc`, and arms direct bounded supervision. |
| `POST /api/safe-tunnel/stop` | Persists disabled intent, cancels retries, and stops only PI WEB's owned child. |

The current Settings panel still presents advanced Control API, local target, and `frpc` inputs. The `frpc` fields are optional overrides and an empty value selects managed acquisition. A later UI leg will collapse this into the normal **Enable Safe Tunnel** / **Disable** flow with inferred production defaults.

## Development

```bash
# PI WEB web/API code (Safe Tunnel does not run in sessiond)
npm run dev:web

# The retained source connector is legacy recovery tooling only
scripts/pi-web-tunnel-dev.sh status --json
```

Safe Tunnel runs only in the web/API process. These lifecycle changes do not touch `sessiond`; no `pi-web-sessiond.service` restart is required.
