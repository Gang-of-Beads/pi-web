# Safe Tunnel connector runtime compatibility

Status: temporary compatibility path during PI WEB-owned Safe Tunnel productization.

PI WEB now owns device login, machine registration, private persisted credentials, desired enabled/disabled intent, and the Control API tunnel-configuration boundary. The `pi-web-tunnel` workspace package remains only to preserve the existing `frpc` start/stop path until managed binary acquisition and direct process supervision are implemented inside PI WEB.

## Current behavior

When the existing browser start route is used, PI WEB:

1. verifies that PI WEB-owned machine state and an `frpc` path exist;
2. persists desired state as `enabled`;
3. passes `$PI_WEB_DATA_DIR/safe-tunnel/config.json` to the compatibility connector through an internal absolute-path environment override;
4. starts the foreground connector command as a tracked child;
5. captures capped stdout/stderr and a private per-launch log; and
6. reports final exit status if the connector or `frpc` exits.

Disable persists `disabled` before delegating to the connector's current PID-file stop command. Credentials stay in PI WEB's private state file and are never placed in command arguments, service definitions, browser responses, or ordinary logs.

The compatibility connector still fetches tunnel configuration itself at start. PI WEB's normalized, tested tunnel-configuration operation is now available for the direct supervisor leg, which will remove that duplicate transport path.

## No service-install plan

Do **not** install a separate systemd user unit, LaunchAgent, Windows service, npm package command, or other process manager for Safe Tunnel. The former service-install design is superseded by the product requirement that the main PI WEB process own startup reconciliation, child lifecycle, restart backoff, heartbeat, disable, and shutdown regardless of whether PI WEB itself runs under systemd, Docker, macOS, Windows, or a manual shell.

The temporary connector package, npm auto-installer, PID-file signaling, and this compatibility document will be removed after PI WEB's managed `frpc` and direct supervisor are complete.
