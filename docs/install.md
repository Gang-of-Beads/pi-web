# Install PI WEB

PI WEB runs as two processes: a long-lived **session daemon** (`pi-web-sessiond`) that owns every Pi session and terminal, and a **web/API server** (`pi-web-server`) that serves the browser UI. The recommended install runs both as per-user services, so sessions survive browser disconnects, SSH logouts and web/API restarts.

- [Requirements](#requirements)
- [Install as user services](#install-as-user-services), including [Termux on Android](#termux-android)
- [Other ways to install](#other-ways-to-install): npm, through Pi, Nix and Home Manager, Docker, WSL or manual run
- [CLI reference](#cli-reference)
- [Session daemon ownership and restarts](#session-daemon-ownership-and-restarts)
- [Update](#update)
- [Remote access](#remote-access)
- [Configure](#configure)
- [Uninstall](#uninstall)

## Requirements

- **Node.js 22.19.0 or newer** and npm, set up so `npm install -g` works without `sudo`. A version manager (nvm, fnm, mise) or Homebrew gives you that. A distribution's packaged Node.js installs global packages into a system folder, and `npm install -g` then fails with `EACCES`; either use a version manager, or point npm at a folder you own with `npm config set prefix ~/.local` and put `~/.local/bin` on your login-shell `PATH`. Do not run the installer with `sudo`: the services would be installed for root.
- **On Linux, python3, make and a C++ compiler.** npm builds the terminal's native module (`node-pty`) during the install, because it has no prebuilt binary for Linux. Install them first: `sudo apt install build-essential python3` (Debian, Ubuntu), `sudo dnf install gcc-c++ make python3` (Fedora). macOS uses the prebuilt binary. On Termux, see [Termux (Android)](#termux-android).
- **Pi Coding Agent 1.3.0 or newer**, configured for your user so the `pi` command works. npm installs the Pi SDK packages PI WEB runs sessions on as its peer dependencies; `pi-web doctor` also expects the `pi` command on your login-shell `PATH`.
- A login shell (bash, zsh or fish) whose `PATH` exposes Node.js, npm, Pi, git and every tool your agents need.
- For `pi-web install`: a per-user service manager, systemd on Linux, launchd on macOS, or termux-services on [Termux](#termux-android). On Linux the user's systemd needs a session bus; minimal Debian and Ubuntu images leave it out, and the install preflight then fails with `Failed to connect to bus`. Install it with `sudo apt install dbus-user-session`, then start it with `systemctl --user start dbus.socket`.

PI WEB services run through your login shell in non-interactive mode (`<shell> -lc`). `PATH` setup that lives only in interactive files or prompt hooks is not visible to them:

- **zsh:** put `PATH` setup in `~/.zprofile`, not only `~/.zshrc`.
- **bash:** use `~/.bash_profile` or `~/.profile`; if `~/.bash_profile` exists, source `~/.profile` from it when needed.
- **nvm:** its installer writes its setup into `~/.bashrc`, which a non-interactive shell skips, so the install preflight reports that `node` is not available to the service shell. Load nvm from `~/.profile` (or `~/.bash_profile`) too, then run `pi-web install` again:

  ```bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  ```
- **fish:** prefer universal `PATH` setup, for example `fish_add_path -U …`.

Before it changes any config or service, the installer checks the requirements of the exact service plan inside the service manager's own context. Commands set with `PI_WEB_SERVER_EXEC` or `PI_WEB_SESSIOND_EXEC` (see [What `pi-web install` writes](#what-pi-web-install-writes)) are written into the services but not executed by that check; run `pi-web doctor` afterwards to repeat the checks.

## Install as user services

With the recommended agent tools and Web plugins of the [Gang of Beads preset](#gang-of-beads-preset):

```bash
curl -fsSL https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.sh | sh -s -- --preset gang-of-beads
```

PI WEB alone:

```bash
curl -fsSL https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.sh | sh
```

The installer runs `npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty`, installs the preset's packages with `pi install` when asked to, then runs `pi-web install`. Node.js and npm must already be on the host, and for the preset a configured `pi` command too. Before installing anything it checks the [requirements](#requirements) it can see (the Node.js version, that npm can install global packages as your user, and on Linux the build tools) and stops with what to fix. Run `pi-web doctor` afterwards to check the result.

Then open <http://127.0.0.1:8504>.

If the install preflight fails, no config or service has been changed. Follow the shell guidance it prints, then run `pi-web install` again.

On a Linux server, also run `sudo loginctl enable-linger "$USER"` so user services keep running after you log out and start at boot.

### Termux (Android)

PI WEB runs natively in [Termux](https://termux.dev) on Android, with its services managed by termux-services. Install the packages it needs, then open a new Termux session so termux-services starts its supervisor:

```bash
pkg install nodejs git python make clang termux-services
```

Install the [Termux:Boot](https://wiki.termux.com/wiki/Termux:Boot) app from the same source as Termux (F-Droid or GitHub) and open it once, so it may start the services when the phone boots. Then run the same installer as above:

```bash
curl -fsSL https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.sh | sh
```

On Termux the installer checks for these packages and stops with the `pkg install` command for any that is missing. Then `pi-web install`:

- writes two termux-services services, `$PREFIX/var/service/pi-web-sessiond` and `$PREFIX/var/service/pi-web`, enables them and starts them;
- writes the Termux:Boot script `~/.termux/boot/pi-web-services`, which takes a wake lock and starts termux-services when the phone boots. Your other boot scripts are left alone. Without the Termux:Boot app the services run until the phone restarts and do not start again by themselves; `pi-web install` and `pi-web doctor` say when the app is missing.
- once the services are up, takes a wake lock with `termux-wake-lock`, so Android does not suspend them before the next boot. Termux shows a persistent notification while PI WEB holds it. Release it with `termux-wake-unlock` or the notification's release action; Android may then stop the services while Termux is in the background. If the wake lock cannot be taken, `pi-web install` says so and still succeeds.

Android stops apps it considers idle. Turn off battery optimisation for Termux and Termux:Boot in the Android settings (**Apps → Termux → Battery → Unrestricted**, worded differently on some phones), or the services can be stopped while the screen is off.

npm builds `node-pty` from source on Termux, and node-gyp there needs the `android_ndk_path` variable defined. When `~/.gyp/include.gypi` does not exist, the installer writes it with `{'variables':{'android_ndk_path':''}}` and says so; an existing file is never changed. Every later build of `node-pty` uses it, including updates from the Updates page. Delete the file to remove it, and `pi-web` updates then fail to build `node-pty` until it is back.

termux-services restarts a service whenever it exits, not only when it fails, and never forces a stop: a session daemon that takes longer than 180 seconds to drain makes `pi-web restart` report a timeout while the daemon keeps stopping.

### Gang of Beads preset

The preset adds the packages below with user-scope `pi install`, then runs `pi-web install`. It installs the same PI WEB package as the plain installer; there is no separate PI WEB edition or core preset setting.

| Capability | Packages |
|---|---|
| Questions and answers | `@gang-of-beads/pi-ask-user` |
| Subagents | `@gang-of-beads/pi-subagents`, `@gang-of-beads/pi-web-subagents` |
| Background tasks | `pi-background-tasks`, `@gang-of-beads/pi-web-background-runs` |
| Goals | `@gang-of-beads/pi-goal`, `@gang-of-beads/pi-web-goals` |
| Extra Web themes | `@gang-of-beads/pi-web-themes` |
| Multiple provider accounts | `@gang-of-beads/pi-multi-account` |
| Pi package updates | `@gang-of-beads/pi-updater` |

Every package installs from npm. The preset uses published releases, not Git checkouts; it is a rolling recommendation, not a version-pinned bundle. The scoped names select the Gang of Beads distributions rather than similarly named upstream packages. See [Packages](plugins.md#packages) for their repositories; the upstream background runtime is maintained by [ismailsaleekh](https://github.com/ismailsaleekh/pi-background-tasks).

Only opt in if you trust these packages: extensions run code with your user's permissions. The installer adds package declarations through Pi; it does not replace your settings file, migrate credentials or accounts, select models, or configure providers. Multi-account still needs your own provider authentication. `pi-bash-autobg` is not included. Workflows (`pi-dynamic-workflows` with `@gang-of-beads/pi-web-workflows`) are left out for now: on Pi 1.x, its workflow subagents cannot use providers that an extension registers, such as multi-account pools. Install them yourself if your providers come from `auth.json` or `models.json`.

If a package installation fails, the script stops before `pi-web install`; packages already installed remain. Resolve the error and rerun the same command. For an existing installation, follow the normal [package restart and reload rules](plugins.md#install-a-plugin) before expecting all new tools and server plugins to appear. A session-daemon restart can interrupt active sessions; check active work first.

## Other ways to install

### With npm

The installer's steps, run by hand:

```bash
npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty
pi-web install
pi-web doctor
```

The scoped `--allow-scripts=node-pty` flag lets npm 12 run the native-module build that PI WEB terminals need, without enabling install scripts for other dependencies.

### Through Pi

PI WEB is also published as a Pi package that adds a `/pi-web` command inside Pi.

```bash
pi install npm:@gang-of-beads/pi-web
```

Then, inside Pi:

```text
/pi-web install
/pi-web status
/pi-web doctor
```

`/pi-web help` lists every subcommand, including `machines`, `logs`, `start`, `stop`, `uninstall`, `version`, `open`, and the fleet-wide `restart --all`, `update --all` and `restart --machine=NAME`.

When `pi-web-server` and `pi-web-sessiond` are not on the service manager's `PATH`, `pi-web install` falls back to the package's own entry points, so an install through Pi works without adding them to your `PATH`.

### Nix and Home Manager

The flake builds PI WEB for `x86_64-linux`, `aarch64-linux` and Apple Silicon macOS (`aarch64-darwin`). Pin a release tag, replacing `<version>` with one from the [releases page](https://github.com/Gang-of-Beads/pi-web/releases):

```bash
nix profile install github:Gang-of-Beads/pi-web/v<version> --accept-flake-config
```

Every release is pushed to the public binary cache [gang-of-beads.cachix.org](https://app.cachix.org/cache/gang-of-beads), so installing a release tag downloads PI WEB instead of compiling it; any other commit builds locally. The flake declares the cache, and Nix honours that declaration only for trusted users. If Nix warns that it ignored the substituter, add the cache once, system-wide, with `cachix use gang-of-beads` or these `nix.conf` lines, then restart the Nix daemon:

```text
extra-substituters = https://gang-of-beads.cachix.org
extra-trusted-public-keys = gang-of-beads.cachix.org-1:oeKLfGX21CJJ8AUAhGoesrIy2i8vlXCEn6yT4x1hqX0=
```

#### Home Manager module

The flake's Home Manager module declares the two services. It works in any Home Manager configuration: standalone, or inside NixOS or nix-darwin.

```nix
inputs.pi-web.url = "github:Gang-of-Beads/pi-web/v<version>";

# In your Home Manager modules, with inputs.pi-web.homeManagerModules.default imported:
programs.pi-web = {
  enable = true;
  package = inputs.pi-web.packages.${pkgs.stdenv.hostPlatform.system}.pi-web;
  # environment.PATH = "...";   # the PATH your agents need; see below
  # settings = { host = "127.0.0.1"; port = 8504; };
};
```

Set `package` to the flake's own package as shown. The module's default package, and `inputs.pi-web.inputs.nixpkgs.follows`, build PI WEB against your nixpkgs, which is a different build from the one in the cache.

Options: `dataDir` (default `~/.pi-web`), `configPath` (default `~/.config/pi-web/config.json`), `environment` (extra variables for both services) and `settings`.

The module differs from `pi-web install` in these ways:

- **PATH.** The services start `pi-web-sessiond` and `pi-web-server` directly, not through a login shell. Sessions, the bash tool and terminals inherit the session daemon's environment, so they see only the service manager's `PATH`. Put the `PATH` your agents need (git, node, pi, build tools) in `programs.pi-web.environment.PATH`.
- **Declarative settings.** With `settings` set, Home Manager writes the config file as a read-only link into the Nix store. Saving from Settings (plugin toggles, path access, uploads, logs, update command) then fails with a "could not save its config file" error. Leave `settings` unset to keep a writable config file that Settings manages. To keep some keys declarative anyway, leave `settings` unset and merge those keys into the file on every switch; the merged keys win and Settings keeps saving everything else. A key that holds a secret belongs in a file your secrets tool renders outside the Nix store, merged the same way.

  ```nix
  home.activation.piWebConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    config=${config.home.homeDirectory}/.config/pi-web/config.json
    [ -L "$config" ] && run rm "$config"
    [ -e "$config" ] || { run mkdir -p "$(dirname "$config")"; (umask 077; echo '{}' > "$config"); }
    (umask 077; run ${lib.getExe pkgs.jq} -s '.[0] * .[1]' "$config" ${pkgs.writeText "pi-web-managed.json" (builtins.toJSON { host = "127.0.0.1"; })} > "$config.tmp")
    run mv "$config.tmp" "$config"
  '';
  ```
- **Shutdown drain.** The `pi-web install` session daemon unit lets in-flight runs finish before the daemon exits (see [Restart the session daemon](#restart-the-session-daemon)). The Home Manager systemd unit lacks those settings: a restart signals every process of the service at once, so commands an agent is running are killed before the daemon can wait for its turn to finish.
- **Logs.** The Home Manager launch agents on macOS set no log file.

Operate the services with `systemctl --user restart pi-web` and `systemctl --user restart pi-web-sessiond` on Linux. On macOS, Home Manager creates the `com.pi-web.web` and `com.pi-web.sessiond` launch agents. Restart the session daemon to run an upgraded version; restarting only the web service leaves the old daemon running.

`nix develop` provides Node.js and native build tools, not pnpm. Run pnpm through Corepack (`corepack pnpm install --frozen-lockfile`) or install pnpm 12.8.1, the version pinned in `package.json`.

### Docker

Docker is a separate install path, in beta, with its own deliberate host access and trust model. Read [docker/README.md](../docker/README.md) before using it.

### WSL or manual run

On WSL without systemd, in a container without a user service manager, or anywhere else `pi-web install` is not supported, run the two processes yourself:

```bash
npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty

# Terminal 1
pi-web-sessiond

# Terminal 2
PI_WEB_PORT=8504 pi-web-server
```

On WSL distributions with systemd enabled, `pi-web install` can work.

## CLI reference

| Command | What it does |
| --- | --- |
| `pi-web install [--dev] [--host H] [--port P] [--config PATH]` | Check the requirements, write the config file if it does not exist, and install and start the services |
| `pi-web uninstall` | Stop, disable and remove the production and development service files |
| `pi-web start` / `stop` / `restart` | Start, stop or restart the installed services |
| `pi-web status` | Show the state of each installed service |
| `pi-web logs` | Follow the service logs: `journalctl --user` on Linux; `~/.pi-web/logs/sessiond.log` and `web.log` on macOS and Termux |
| `pi-web doctor` | Check the login-shell environment, the service plan, the `node-pty` native module, the installed and running versions, and the [HTTPS certificate](#serve-https-directly) when one is configured |
| `pi-web version` | Compare the installed package version with the versions the running services report |
| `pi-web --version` | Print the installed package version |
| `pi-web plugins disable <plugin-id>` | Disable a PI WEB plugin offline; see [Offline disable and safe start](config.md#offline-disable-and-safe-start) |
| `pi-web plugins safe-start show\|clear\|set <bundled-only\|none>` | Start the session daemon without external server plugins; same section |

`pi-web install` flags:

- `--host` (default `127.0.0.1`) and `--port` (default `8504`) apply only when the install creates the config file. Once it exists, edit `host` and `port` in the config file or in **Settings → General** instead.
- `--config PATH` uses another global config file (default `$XDG_CONFIG_HOME/pi-web/config.json`, or `~/.config/pi-web/config.json`) and records it in the services as `PI_WEB_CONFIG`.
- `--dev`, run from a PI WEB checkout, installs the development services instead: a session daemon that runs from the checkout without reloading, and one service for the web/API server and the Vite UI, which reload when the code changes. The UI is then at <http://127.0.0.1:8505>; it listens on every interface (`0.0.0.0`) without authentication, so use `--dev` only on a network you trust.

### What `pi-web install` writes

- **Service definitions:** `~/.config/systemd/user/pi-web-sessiond.service` and `pi-web.service` (and `pi-web-ui-dev.service` with `--dev`) on Linux; `~/Library/LaunchAgents/com.pi-web.sessiond.plist` and `com.pi-web.web.plist` (and `com.pi-web.ui-dev.plist`) on macOS; the `run` scripts in `$PREFIX/var/service/pi-web-sessiond` and `pi-web` (and `pi-web-ui-dev`) plus the boot script `~/.termux/boot/pi-web-services` on Termux.
- **Logs:** on macOS and Termux the services write to `~/.pi-web/logs`; on Linux their output goes to the journal.
- **Recorded environment:** a service manager does not inherit your shell's environment. The installer records `PI_WEB_LOG_DIR`, `PI_WEB_CONFIG` when `--config` is given, and `PI_WEB_UPDATE_COMMAND` when it is set in the installing shell. Other variables are not captured.
- **Command overrides:** set `PI_WEB_SERVER_EXEC` or `PI_WEB_SESSIOND_EXEC` when you run `pi-web install` to start the services with your own command instead of `pi-web-server` or `pi-web-sessiond`.

## Session daemon ownership and restarts

The session daemon is the long-lived owner of PI WEB's session runtime. It hosts every Pi session, and everything an agent spawns (bash tools, terminals, subsessions) inherits its environment. At startup it claims the instance's state: the data directory (`~/.pi-web`, or `PI_WEB_DATA_DIR`) and the socket in it (`~/.pi-web/sessiond.sock`, a named pipe derived from the data directory on Windows, or `PI_WEB_SESSIOND_SOCKET`). A second daemon started against the same data directory finds the live owner and exits with an error naming what it needs. The web/API server of the same instance shares the data directory without claiming it.

Restart the web/API server first, then the session daemon, and restart the daemon only when a change needs it: it owns running sessions and terminals. Service managers briefly overlap the outgoing and incoming daemon; the startup claim waits a short grace period for the previous daemon to let go, so a normal service restart does not trip the ownership error.

### Restart the session daemon

| Install | Command |
| --- | --- |
| `pi-web install` on Linux | `systemctl --user restart pi-web-sessiond` |
| `pi-web install` on macOS | `launchctl kickstart -k gui/$(id -u)/com.pi-web.sessiond` |
| `pi-web install` on Termux | `sv -w 180 restart $PREFIX/var/service/pi-web-sessiond` |
| Docker | `restart-sessiond`, see [docker/README.md](../docker/README.md) |
| Manual run | Stop `pi-web-sessiond` and run it again |

On stop, the session daemon waits up to 60 seconds for in-flight agent runs to finish (`PI_WEB_SHUTDOWN_DRAIN_MS`; `0` exits at once). The `pi-web install` systemd unit allows 180 seconds before it forces the stop. Review active work before restarting the daemon.

### Run a second instance

Every process of a second instance needs its own data directory, socket and port. Run both processes in the same environment:

```bash
export PI_WEB_DATA_DIR=~/.pi-web-2
export PI_WEB_SESSIOND_SOCKET=~/.pi-web-2/sessiond.sock
export PI_WEB_PORT=8502

pi-web-sessiond   # terminal 1
pi-web-server     # terminal 2, same environment
```

Set `PI_WEB_CONFIG` to a separate file as well, or both instances share plugin, path-access and other settings. `pi-web install` manages one instance per user.

Processes spawned inside PI WEB inherit the daemon's `PI_WEB_*` values and `PI_WEB_SESSION=1`, so an instance started from inside a session with those inherited values fails at startup instead of taking over the running one.

## Update

- **npm global install:** `npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty`, then `pi-web restart`. The Updates page offers the same update.
- **Your own update command:** set `updateCommand` in **Settings → General → Updates** (or `PI_WEB_UPDATE_COMMAND` in the services) and the Updates page runs it; see [Updates](config.md#updates).
- **Nix:** upgrade the profile or switch your Home Manager configuration to a newer tag, then restart the services.
- **Git checkout:** pull, run `pnpm install --frozen-lockfile` (and `pnpm run build` if you run the built server), then restart the web/API server and the session daemon.

## Remote access

PI WEB listens on `127.0.0.1:8504` by default. To use it from your phone, tablet or another computer, we recommend [Tailscale Serve](https://tailscale.com/kb/1312/serve): PI WEB keeps listening on loopback, and Tailscale publishes it over HTTPS to the devices on your tailnet only.

On the machine running PI WEB, with Tailscale installed and MagicDNS and HTTPS certificates enabled for your tailnet:

```bash
tailscale serve --bg --https=8504 http://127.0.0.1:8504
tailscale serve status
```

On Linux, run `tailscale serve` with `sudo`, or once `sudo tailscale set --operator=$USER` to manage it as yourself.

Then open `https://<machine>.<tailnet>.ts.net:8504` on any device signed in to the tailnet. The setting persists across reboots; `tailscale serve --https=8504 off` removes it.

HTTPS matters beyond encryption: browsers allow the microphone for dictation and clipboard access only on a secure page, and a page opened over HTTPS can reach other [machines](machines.md#https) only at HTTPS URLs. Serving every machine this way covers all of these.

- Keep PI WEB on `127.0.0.1`. Tailscale itself listens on the tailnet address for the served port, so binding PI WEB to `0.0.0.0` or the tailnet address on the same port fails at startup with `EADDRINUSE`.
- Use `tailscale serve`, not `tailscale funnel`: Funnel publishes to the public internet.
- Anyone on your tailnet who can reach the port can use PI WEB as you. Use Tailscale access controls to limit who can reach the machine on a shared tailnet.

### Serve HTTPS directly

When you already have a certificate for the machine's name and do not run Tailscale Serve or another reverse proxy, PI WEB can serve HTTPS itself. Provide the certificate chain and its private key as PEM files in the global config:

```json
{
  "host": "100.101.102.103",
  "tls": {
    "certFile": "~/.config/pi-web/tls/cert.pem",
    "keyFile": "~/.config/pi-web/tls/key.pem"
  }
}
```

or set `PI_WEB_TLS_CERT` and `PI_WEB_TLS_KEY`, then restart the web/API. WebSockets switch to `wss://` with it; the session daemon is unaffected. With Tailscale, for example:

```bash
mkdir -p ~/.config/pi-web/tls
tailscale cert --cert-file ~/.config/pi-web/tls/cert.pem --key-file ~/.config/pi-web/tls/key.pem <machine>.<tailnet>.ts.net
```

On Linux, `tailscale cert` may need `sudo`, or `sudo tailscale set --operator=$USER` once, and the files must then be readable by your user.

- PI WEB does not issue or renew certificates. Run your renewal (here, the same `tailscale cert` command) on a schedule; PI WEB checks the files every 10 minutes and swaps in a renewed certificate without a restart. A renewal it cannot use is logged, and the running certificate stays.
- If the files cannot be read, the key does not match the certificate, or the certificate has expired, the web/API refuses to start and logs which file is wrong; it never falls back to plain HTTP. `pi-web doctor` checks the same files.
- Browsers check the certificate against the name in the address bar, so open PI WEB by the name the certificate was issued for, and bind `host` to an address that name reaches. Keep the key readable only by you (`chmod 600`).
- Do not combine this with `tailscale serve` on the same port: both would listen there.
- Switching an address from `http://` to `https://` is a new origin to the browser. Drafts and unsent messages the browser keeps for the old address do not carry over, so send or copy them first, and a machine you reach with **This browser** asks to approve the new address again.
- In the development setup (`pi-web install --dev`), the UI on port 8505 stays plain HTTP on loopback and reaches the HTTPS web/API on its own.

For a quick one-off connection without a VPN, an SSH tunnel works too:

```bash
ssh -L 8504:127.0.0.1:8504 user@your-server
# Open http://127.0.0.1:8504 on your local machine
```

PI WEB is designed for trusted users and trusted server paths. Do not expose it directly to the public internet. On a VPN or private network, bind PI WEB to the server's VPN or private address (for example a Tailscale, NetBird, WireGuard or LAN address) and make sure the network limits who can reach it. Avoid `0.0.0.0` unless a firewall, VPN or authenticated reverse proxy strictly controls the port. See [SECURITY.md](../SECURITY.md) for the threat model.

To use several PI WEB machines from one page, see [Machines](machines.md).

### Install on iPhone or iPad

Open PI WEB in Safari, choose **Share → Add to Home Screen**, then **Add**. The installed app opens in standalone mode. For remote access, serve PI WEB with [Tailscale Serve](#remote-access) or another HTTPS reverse proxy on a trusted VPN or private network.

The installed app is a control surface for the sessions on the server, so it needs a live connection. It does not cache the application for offline use.

### Reverse proxy at the root or under a path prefix

The published client works at the origin root (`/`) and at nested prefixes such as `/ai/` or `/test/ai/` with no rebuild or PI WEB setting.

For a root deployment, proxy `/` to `http://127.0.0.1:8504` without rewriting the path. For a nested deployment:

1. Redirect the slashless prefix, such as `/ai`, to `/ai/`. The browser uses the trailing-slash URL as the application base.
2. Strip the prefix before forwarding. PI WEB serves root paths on its own listener.
3. Apply authentication to the whole `/ai/` application and forward the headers and cookies it needs.
4. Forward WebSocket upgrades through the same location as HTTP traffic.

```nginx
# http context
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name pi.example.com;

    ssl_certificate     /etc/letsencrypt/live/pi.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pi.example.com/privkey.pem;

    auth_basic "PI WEB";
    auth_basic_user_file /etc/nginx/pi-web.htpasswd;

    location = /ai {
        return 308 /ai/$is_args$args;
    }

    location ^~ /ai/ {
        # The trailing slash strips /ai/ before forwarding.
        proxy_pass http://127.0.0.1:8504/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Cookie $http_cookie;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
    }
}
```

For `/test/ai/`, change both locations. Keep your authentication policy on the whole prefixed location; do not create unprotected exceptions for `/api/` or `/pi-web-plugins/`. With this setup, assets, images, API calls, plugins, WebSockets and the installed app's start URL and scope all stay inside the prefix.

## Configure

The installer writes the global config file to `~/.config/pi-web/config.json` (or `$XDG_CONFIG_HOME/pi-web/config.json`), unless you pass `--config`. At runtime, `PI_WEB_CONFIG` selects another file.

```json
{
  "host": "127.0.0.1",
  "port": 8504,
  "pathAccess": {
    "allowedPaths": ["~/SDKs", "/opt/reference"]
  }
}
```

Use **Settings → General** for host, port and external file roots, **Settings → Pi Packages** for Pi packages, **Settings → PI WEB Plugins** for plugins, and **Settings → Keyboard** for shortcuts. The [configuration reference](config.md) covers every key, project-local `.pi-web/config.json`, restart rules and environment variables; [plugins](plugins.md) covers enabling plugins and the restarts they need.

## Uninstall

`pi-web uninstall` stops, disables and removes PI WEB's production and development services, and on Termux its boot script; there it also releases the wake lock with `termux-wake-unlock`. It keeps the npm package, the config file and the data directory.

```bash
pi-web uninstall
npm uninstall -g @gang-of-beads/pi-web
```

To also delete PI WEB's config and state:

```bash
CONFIG_FILE="${PI_WEB_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/pi-web/config.json}"
DATA_DIR="${PI_WEB_DATA_DIR:-$HOME/.pi-web}"
rm -f "$CONFIG_FILE"
rmdir "$(dirname "$CONFIG_FILE")" 2>/dev/null || true
rm -rf "$DATA_DIR"

# If you configured a socket outside PI_WEB_DATA_DIR, remove it too:
[ -z "${PI_WEB_SESSIOND_SOCKET:-}" ] || rm -f "$PI_WEB_SESSIOND_SOCKET"
```

If you installed with `pi-web install --config /custom/path.json`, delete that file instead of the default config path.
