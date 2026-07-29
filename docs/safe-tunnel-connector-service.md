# Safe Tunnel connector package compatibility

Status: retained source/recovery code; not used by PI WEB's browser runtime.

PI WEB now owns device approval, machine registration, private persisted credentials, desired enabled/disabled intent, normalized tunnel configuration, pinned/verified managed `frpc`, and the exact supervised child process. The browser's single enable/status/disable flow never discovers, npm-installs, or executes `pi-web-tunnel`.

## Current PI WEB runtime

When the browser enable route reaches runtime startup, PI WEB:

1. verifies that PI WEB-owned machine state exists and persists desired state as `enabled`;
2. fetches normalized tunnel config through its application-owned Control API boundary;
3. uses the advanced `frpc` path when configured, otherwise selects/downloads/extracts and SHA-256 verifies the pinned managed artifact;
4. atomically writes private generated TOML beneath `$PI_WEB_DATA_DIR/safe-tunnel/`;
5. launches `frpc` directly and retains the exact child handle;
6. restarts unexpected child/preparation failures with bounded exponential backoff that resets only after stable operation;
7. reconciles persisted enabled intent when the web/API process starts;
8. sends server-scheduled heartbeats with bounded interval and failure recovery, stopping on rejected/revoked credentials; and
9. cancels reconciliation/heartbeat/process timers and listeners, gracefully stops that same handle, and removes generated TOML on disable or web/API shutdown.

No PID file participates in PI WEB-owned status or stop. Shutdown stops the process without changing enabled intent; the next web/API startup recovers that intent. Heartbeat work is aborted and awaited before child shutdown.

## Retained legacy package

The `packages/tunnel-connector`, `packages/tunnel-frp-engine`, source wrapper, command-discovery/npm-installer module, and their old PID-file CLI behavior remain temporarily for development/recovery and historical tests. The dedicated cleanup leg will remove that package shape; this lifecycle slice does not begin that cleanup.

Legacy connector environment variables are ignored by PI WEB's built-in runtime. Running the source wrapper directly can still use its own legacy config and PID-file behavior, but that is not the normal product path and must not own the PI WEB browser runtime's state.

## No service-install plan

Do **not** install a separate systemd user unit, LaunchAgent, Windows service, npm package command, or other process manager for Safe Tunnel. The main PI WEB web/API process owns child supervision whether PI WEB itself runs under systemd, Docker, macOS, Windows, or a manual shell. Fastify shutdown and web-process `SIGINT`/`SIGTERM` handling stop the owned child; no `sessiond` code is involved.
