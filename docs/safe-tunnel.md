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
- an optional advanced `frpc` path override retained for the temporary runtime path;
- private machine id/token and Control API location;
- non-secret machine slug/public URL metadata.

Desired intent is independent from observed runtime state. Starting currently persists `enabled` before launching the compatibility runtime; stopping persists `disabled` before asking it to stop. A stopped or failed runtime therefore does not silently erase what the user requested.

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

The same PI WEB-owned boundary fetches per-machine tunnel configuration and applies the private local PI WEB URL to the returned TOML. Managed binary installation and direct `frpc` process supervision are separate follow-up work.

## Temporary connector runtime compatibility

Authentication and credential persistence no longer shell out to `pi-web-tunnel`. Until PI WEB's managed binary and direct supervisor are complete, the existing start/stop implementation still invokes the connector package as a temporary runtime adapter. PI WEB passes its private state path through an internal environment override, so the connector reads PI WEB's authoritative credential file rather than owning a second copy.

Current start behavior still requires an `frpc` executable path. The bridge tracks the foreground connector process, truncates the private `connector.log` for each launch, captures capped/sanitized output, and delegates stop to the connector PID-file path. Do not install a separate system service for this compatibility runtime; PI WEB-owned supervision will replace it.

Packaged/source behavior for locating this temporary command is unchanged for now:

- `PI_WEB_SAFE_TUNNEL_CONNECTOR_COMMAND` selects an explicit connector command.
- Source development prefers `scripts/pi-web-tunnel-dev.sh`.
- The existing optional npm-install fallback remains until the connector-package cleanup leg.

These are transitional implementation details, not the finished no-manual-step product contract.

## Local browser API

The browser-facing routes remain:

| Method/path | Purpose |
| --- | --- |
| `GET /api/safe-tunnel/status` | Returns redacted PI WEB-owned registration, persisted desired state, compatibility runtime status, and an active operation when present. |
| `POST /api/safe-tunnel/login` | Starts PI WEB-owned device authorization and machine registration. |
| `GET /api/safe-tunnel/operations/:operationId` | Polls a tracked login/start operation. |
| `POST /api/safe-tunnel/start` | Persists enabled intent and starts the temporary connector runtime. |
| `POST /api/safe-tunnel/stop` | Persists disabled intent and stops the temporary connector runtime. |

The current Settings panel still presents advanced Control API, local target, and `frpc` inputs. A later UI leg will collapse this into the normal **Enable Safe Tunnel** / **Disable** flow with inferred production defaults.

## Development

```bash
# PI WEB web/API code (Safe Tunnel does not run in sessiond)
npm run dev:web

# Temporary connector runtime diagnostics
scripts/pi-web-tunnel-dev.sh status --json
```

Safe Tunnel changes in this slice do not touch `sessiond`; no `pi-web-sessiond.service` restart is required.
