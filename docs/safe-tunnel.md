# Experimental PI WEB Safe Tunnel

Safe Tunnel is an experimental, gateway-local way to make the running PI WEB reachable through a selected tunnel ingress. It is completely unavailable by default and must be explicitly enabled for the web/API process before its Settings panel, browser API, routes, state, or runtime can be used.

> **Protect the public ingress.** A tunnel can make PI WEB reachable outside its local network. This repository does not claim that a hosted or self-hosted ingress authenticates users. Use Safe Tunnel only when the selected ingress actually enforces appropriate authentication and access control for every HTTP and WebSocket request.

## Make Safe Tunnel available

Set the global config key to the JSON boolean `true`:

```json
{
  "safeTunnel": true
}
```

Global config lives at `$PI_WEB_CONFIG`, `$XDG_CONFIG_HOME/pi-web/config.json`, or `~/.config/pi-web/config.json`. `safeTunnel` is gateway-only: it is not accepted in project-local or selected-machine config.

Alternatively, set the web/API service environment:

```sh
PI_WEB_SAFE_TUNNEL=1
```

A non-empty `PI_WEB_SAFE_TUNNEL` value takes precedence over the config file in both directions. `1` and case-insensitive `true` enable availability; `0`, `false`, and every other non-empty value disable it. An empty value is treated as unset. The config-file value must be a JSON boolean; strings, numbers, and `null` are rejected rather than coerced.

Restart the **web/API process** after changing the config key or environment. Safe Tunnel availability is a startup snapshot. It is not owned by `sessiond`, so no session-daemon restart is required.

Any non-empty `PI_WEB_OFFLINE` or `PI_OFFLINE` setting overrides both opt-in mechanisms and keeps Safe Tunnel unavailable. Without active opt-in, PI WEB does not construct the production Safe Tunnel graph, read or migrate its state, register its routes or lifecycle, start background network/process work, or expose its browser controls. Direct Safe Tunnel API probes receive the same generic `404` as any unknown API route.

## Availability and desired state are separate

Safe Tunnel has two independent controls:

| Control | Meaning | Default |
| --- | --- | --- |
| Global availability (`safeTunnel` / `PI_WEB_SAFE_TUNNEL`) | Whether this web/API process may expose or run Safe Tunnel at all | Unavailable |
| Durable desired state (**Enable Safe Tunnel** / **Disable Safe Tunnel**) | Whether an available Safe Tunnel should be running and reconciled | Disabled |

Making the feature available does not start a tunnel. The Settings action changes durable desired state; it does not change global availability. Turning availability off and restarting leaves durable desired state untouched while the feature is dormant.

## Enable, approve, inspect, and disable

After opting in and restarting:

1. Open **Settings → Safe Tunnel**, or run **Manage Safe Tunnel** from the action palette.
2. Confirm that the selected ingress provides the authentication and access control your deployment requires.
3. Choose **Enable Safe Tunnel**. The normal flow sends no advanced overrides. PI WEB infers the local target from its active TCP listener, derives a machine name and collision-resistant slug, and uses the production Control API default `https://api.tunnels.pi-web.dev`.
4. If registration is needed, open the displayed provider approval page and follow its instructions. The panel polls the tracked operation through preparation, approval, registration, and startup. Private machine credentials stay in the web/API process and its local state; the browser receives only approval progress and redacted status.
5. When startup succeeds, the panel shows the public URL and supervised runtime status.

PI WEB reuses an active registration when possible. If the provider rejects or revokes it, supervision stops, the durable diagnostic is retained, and the panel offers Enable again for replacement approval.

Choose **Disable Safe Tunnel** to cancel an in-progress approval/enable operation, persist disabled intent, cancel retries and heartbeats, and stop only the exact child process PI WEB owns. The diagnostics disclosure reports bounded, sanitized operation/runtime output and stable recovery categories; it does not expose machine tokens, generated TOML, provider response bodies, artifact URLs or hashes, or raw transport causes.

## Durable state and graceful restarts

PI WEB stores private Safe Tunnel state beneath its managed data directory:

```text
$PI_WEB_DATA_DIR/safe-tunnel/config.json
```

`PI_WEB_DATA_DIR` defaults to `~/.pi-web`. The state contains desired intent, local-target and advanced-path choices, private machine credentials, credential status, Control API location, and non-secret machine/public URL metadata. On POSIX systems, PI WEB restricts the directory to `0700` and the atomically replaced state file to `0600`; treat the file as a secret regardless of platform.

When PI WEB-owned state is absent, the first available-state read can import a former standalone config (normally `~/.config/pi-web-tunnel/config.json`) with **disabled** intent. The legacy source is left untouched. No read or migration occurs while Safe Tunnel is unavailable.

A graceful web/API shutdown stops owned runtime work and removes generated runtime configuration without changing enabled intent. If availability remains on, the next web/API start reads that intent and resumes bounded reconciliation and supervision. To make the feature dormant, turn availability off and gracefully restart the web/API process: the old process stops its owned child, and the new process leaves Safe Tunnel state and runtime inactive. Re-enabling availability later can reconcile the preserved intent.

## Security and trust boundaries

- **Ingress authentication is an operator requirement.** The tunnel transport itself is not evidence that the resulting public endpoint is authenticated. Verify the actual ingress policy before exposing PI WEB.
- **Control API credentials require protected transport.** Production and self-hosted Control API URLs must use HTTPS. Plain HTTP is accepted only for URL-parser-normalized literal loopback development endpoints in `127.0.0.0/8` or `[::1]`; names such as `localhost` are not exceptions.
- **Provider tunnel configuration is constrained.** PI WEB accepts one expected HTTP proxy only, validates its public hostname and provider-declared local target, and regenerates the final local target from PI WEB-owned desired state. Extra proxies, arbitrary target changes, unknown fields, and disabled transport TLS are rejected.
- **External requests are bounded and cancellable.** Control API and managed-artifact requests use bounded response sizes and timeouts. Disable/shutdown aborts work where safe; if one-time registration has already returned successfully, PI WEB saves that credential before completing cancellation so it is not lost.
- **State and diagnostics stay private.** Safe Tunnel API responses are non-cacheable and redacted. Do not publish `$PI_WEB_DATA_DIR/safe-tunnel`, its generated runtime files, or an advanced executable path.

## Managed `frpc` support

The managed path uses independently pinned official `fatedier/frp` **0.69.1** release artifacts for exactly these Node platform/architecture pairs:

| Platform | Architecture | Managed support |
| --- | --- | --- |
| Linux | `arm64` | Official pinned archive and executable |
| Linux | `x64` (x86-64/amd64) | Official pinned archive and executable |

PI WEB performs a bounded HTTPS download only after Enable needs the artifact, verifies the pinned archive and exact executable size/digest, extracts only the expected regular-file entry, and installs it privately beneath:

```text
$PI_WEB_DATA_DIR/safe-tunnel/frpc/versions/0.69.1/<platform>-<architecture>/frpc
```

Every other platform/architecture fails clearly as `unsupported_platform` before a managed download. To use one of those targets, provide a user-supplied **absolute** executable path under the advanced disclosure. An advanced path bypasses PI WEB's managed artifact download and integrity verification; the operator is responsible for the binary's provenance, compatibility, permissions, and updates. PI WEB still launches it directly without a shell and supervises only the exact returned child.

## Advanced development and self-hosting overrides

The normal flow should leave every advanced field blank. Overrides are sent only on the next Enable request:

| Field | Behavior |
| --- | --- |
| Control API URL | Uses production by default. A self-hosted URL must satisfy the HTTPS/literal-loopback policy above and contain no credentials, query, or fragment. |
| Machine name / slug | Replaces inferred identity. The slug must be one lowercase DNS label. |
| Local PI WEB URL | Replaces the listener-derived target. It must be an `http://` origin with an explicit port and no credentials, path, query, or fragment. It determines which local service is exposed, so point it only at the intended PI WEB listener. |
| `frpc` path | Uses the absolute executable directly instead of managed acquisition. |

Blank fields send no override. A saved self-hosted Control API or `frpc` override remains in effect when the corresponding field is left blank. Explicit Control API/name/slug changes request replacement registration; local-target or `frpc`-path changes can reuse an existing active registration.

## Local browser API

These gateway-local routes exist only while Safe Tunnel availability is active:

| Method and path | Purpose |
| --- | --- |
| `GET /api/safe-tunnel/status` | Read redacted desired state, registration/runtime status, diagnostics, and the active operation. |
| `POST /api/safe-tunnel/enable` | Start one approval-through-supervision operation. The normal body is `{}`; optional overrides are nested under `advanced`. |
| `POST /api/safe-tunnel/disable` | Cancel enablement, persist disabled intent, cancel background work, and stop the owned child. |
| `GET /api/safe-tunnel/operations/:operationId` | Poll approval/startup progress and terminal outcome. |

## Development and service ownership

Safe Tunnel runs only in the PI WEB web/API process:

```sh
npm run dev:web
```

It does not run in `sessiond` and requires no separate connector package, command, service, PID file, or connector-owned config path. Restart the web/API process after changing availability; do not restart the long-lived session daemon for this feature.
