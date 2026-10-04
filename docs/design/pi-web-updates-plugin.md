# The PI WEB Updates plugin

Status: approved for PI WEB itself, nix included (owner, 2026-10-04: "先只做
PI WEB 本身的更新（含 nix），pi 和扩展以后再说"). The pi CLI and extension
rows, and keeping pi-updater quiet inside PI WEB, wait. Supersedes the B18 line in
`state-diagram.md` D6 ("pi-updater retired in nix-config").

## Why

The owner's ruling (2026-10-04): pi-updater stays as it is, for pi's terminal.
PI WEB gets its own update plugin, fitted to PI WEB, that knows how each thing
was installed and updates it that way.

What happens today when pi-updater runs inside PI WEB (traced on 8505,
2026-10-04 11:19):

1. It offers "Update now" because PI WEB now runs `ctx.ui.custom` factories,
   which is the probe pi-updater uses to decide a host can install.
2. The install runs behind pi's `BorderedLoader`, which needs pi's global theme;
   PI WEB's daemon never initialized it, so the screen threw
   `Theme not initialized` before any command ran.
3. Had it run, it would have run the wrong program: it re-executes
   `process.argv[1]`, which in PI WEB is `dist/server/sessiond.js`, not pi.
4. It compares against the pi PI WEB bundles (0.99.2), not the `pi` on the
   machine's PATH (0.87.0 here), so its "pi is out of date" speaks about a copy
   only a PI WEB release can change.

## What it updates

Three things, each with its own version source, install-method detector and
update action. Every row names the machine it belongs to (machine + its own
daemon), and the plugin reads and acts on the machine being viewed.

| Thing | Version now | Latest | How it is updated |
|---|---|---|---|
| PI WEB | the running web and daemon (`/api/pi-web/status`) | npm registry `@gang-of-beads/pi-web` | by install method, below |
| pi (the CLI on PATH) | `pi --version` | npm registry `@earendil-works/pi-coding-agent` | `pi update --self`, which knows its own install method; nix and other managers below |
| pi extensions (`~/.pi/agent` packages) | each package's checkout or npm version | its remote | `pi update --extensions` |

The pi PI WEB bundles is shown as "bundled with PI WEB x.y.z": it changes only
with a PI WEB update, and has no button of its own.

## PI WEB install methods

Detection order, first match wins (the existing `detectPiWebInstallation`
covers the first four; nix is new):

| Kind | Detected by | Update | Restart |
|---|---|---|---|
| `docker` | `PI_WEB_DOCKER_MODE` / image roots | the container's own update command (exists) | its restart command |
| `pi-package` | listed in the active agent profile's packages | `pi update <source>` (exists) | native services or `pi-web restart` |
| `npm-global` | package root under `npm root -g` | `npm install -g @gang-of-beads/pi-web` (exists) | `pi-web restart` or native services |
| `nix` (new) | package root under `/nix/store` | see below | native services (launchd / systemd units the nix module installs) |
| `git` (today `local`) | a git checkout with an upstream | `git pull --ff-only && pnpm install && pnpm run build` (exists) | native services |
| `unknown` | none of the above | no button; the offer says which version is out and that this install's manager updates it | none |

**Nix**, in order:

1. **A configured command** wins: `PI_WEB_UPDATE_COMMAND` (the owner's
   nix-config already sets it to `scripts/pi-web-update.sh --force <flake-id>`,
   which re-pins the flake input to the latest release, switches home-manager,
   restarts the services and pushes the pin), or the new config key
   `updates.piWeb.command` in `~/.config/pi-web/config.json`, editable in the
   plugin's Settings page.
2. **An imperative profile**: `nix profile list --json` has an element whose
   store path is the running package -> `nix profile upgrade <element>`, then
   the native-service restart.
3. **Declarative (home-manager, nix-darwin, NixOS) without a command**: no
   button. The offer names the version, says "this install is managed by your
   nix configuration", shows the two steps for a flake input named `pi-web`
   (`nix flake update pi-web`, then your switch command), and links to the
   Settings field where the command can be saved.

A command runs in a detached terminal run (the existing command-run surface),
so its output is visible and a web or daemon restart in the middle does not
lose it. The offer names the machine it is for (owner: "shown-machine").

## pi-updater inside PI WEB

pi-updater is not changed. PI WEB keeps it quiet in its own sessions by setting
`PI_SKIP_VERSION_CHECK=1` on the daemon's own process before extensions load
(pi-updater's `shouldSkipAutoChecks` reads it once, at module load). The value
is removed from the environment PI WEB hands to terminals and command runs, so
a `pi` started from a PI WEB terminal still checks for itself. A reader can
still type `/update` in a PI WEB session; it then fails as it does today
(documented: "use the Updates page").

## Surfaces

- **Settings -> Updates** (per machine): one row per thing above: current,
  latest, install method, Check now, Update. Extension rows list each package
  with its own state. A check runs at most once per machine per 6 hours and on
  Check now; it never runs per session.
- **The update offer** (exists for PI WEB) covers PI WEB only, names the
  machine, and appears for the machine being viewed. It is not shown for a
  version the reader skipped.
- After an extension or pi update the running sessions keep the code they
  loaded; the row says "applies to new sessions; restart the session daemon to
  apply everywhere", with the restart command.

## Order of work

1. Nix detection and the configured command (server; web restart).
2. Settings -> Updates page with the three sections and Check now.
3. pi and extension updates through command runs.
4. Quiet pi-updater in the daemon (daemon restart).
5. Docs: `docs/install.html` "Updating", `docs/plugins.md` for the plugin.
