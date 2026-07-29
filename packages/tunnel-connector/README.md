# @jmfederico/pi-web-tunnel

Temporary connector/runtime compatibility package for PI WEB Safe Tunnels.

PI WEB's web/API process now owns device login, registration, private machine credentials, enabled/disabled intent, and the application-level Control API boundary. The package remains in the workspace only while PI WEB still delegates foreground `frpc` start/stop to the legacy runtime; it is not the finished product installation model and should not be installed as a separate service.

## Development commands

The standalone commands remain available for source compatibility and local recovery:

```bash
pi-web-tunnel login --control-api-url https://control.tunnels.pi-web.dev \
  --machine-name "My dev box" \
  --machine-slug my-dev-box \
  --local-pi-web-url http://127.0.0.1:8504 \
  --frpc-path /absolute/path/to/frpc
pi-web-tunnel status --json
pi-web-tunnel start
pi-web-tunnel stop
```

Source-tree development should use `scripts/pi-web-tunnel-dev.sh` or `npm run tunnel:connector -- <command>` so workspace TypeScript imports resolve.

When PI WEB invokes the temporary runtime it supplies an internal absolute config-path override. The connector then reads PI WEB's authoritative `$PI_WEB_DATA_DIR/safe-tunnel/config.json`, writes runtime files beside it, and never includes `machineToken` in status output. Standalone commands without that override retain the legacy config discovery behavior for development/recovery compatibility.

PI WEB now supplies its verified managed `frpc` path to this compatibility command. Direct PI WEB process supervision will replace the package path itself. See `../../docs/safe-tunnel.md` and `../../docs/safe-tunnel-connector-service.md`.
