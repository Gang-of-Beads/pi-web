# PI WEB workspace-provider example

This standalone package is a starting point for a PI WEB plugin with a browser half (browser API v2) and a server half (server API v1) that owns a project's workspaces. It claims only projects that opt in with a marker file, publishes non-secret metadata to the browser, and answers a browser request from the server provider that owns the workspace.

It imports only the published declarations:

- `@gang-of-beads/pi-web/plugin-api`
- `@gang-of-beads/pi-web/server-plugin-api`

It runs on PI WEB 2.202609.0 or later (the first release with a panel `toolbar`) and builds against the declarations of `@gang-of-beads/pi-web` 2.202610.5.

## Build and install

Copy `examples/workspace-provider-plugin/` out of the PI WEB repository or the installed `@gang-of-beads/pi-web` package, then run:

```bash
npm install --ignore-scripts
npm run build
mkdir -p ~/.pi-web/plugins
ln -s "$PWD" ~/.pi-web/plugins/example-workspaces
```

`--ignore-scripts` skips building PI WEB's native terminal module, which the example does not need: it uses the package for its type declarations only. If `PI_WEB_DATA_DIR` is set, link into `$PI_WEB_DATA_DIR/plugins` instead. The link name must be a valid plugin id and must not collide with another package.

Opt one registered PI WEB project into this example provider:

```bash
mkdir -p /absolute/path/to/project/.pi-web
touch /absolute/path/to/project/.pi-web/example-workspace-provider
```

Then restart the session daemon on that machine and reload the browser. For the systemd user service:

```bash
systemctl --user restart pi-web-sessiond
```

Restarting the session daemon may interrupt running sessions. Restarting the browser or the web server alone does not start a server half.

Open the opted-in project. The **Example Provider** page shows the public marker metadata, and its **Request backend summary** button calls the owning server provider's `summary` operation. Remove the marker and restart the session daemon to stop claiming that project.

## Boundary demonstrated by the package

`package.json` declares:

- browser module `dist/browser/index.js` with `browserRoot: "dist/browser"`;
- server module `dist/server.js`, outside the browser root;
- `machineSpecific: true`, so each machine uses its own copy. A dual entry defaults to it; a dual entry whose browser half works against any machine's backend may set `false`.

Only files under `dist/browser/` are served to the browser. Sources, package metadata, the server module and dependencies are not. Keep secrets out of `publicMetadata`: every browser script and API consumer can read it.

The provider does not offer workspace removal. For removal plans, package limits, federation and the rest of the contract, see the [plugin API reference](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugin-api.md) and the [plugin authoring guide](https://github.com/Gang-of-Beads/pi-web/blob/main/docs/plugin-authoring.md).
