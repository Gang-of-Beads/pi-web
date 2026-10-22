# Install PI WEB

PI WEB runs as two processes: a long-lived **session daemon** (`pi-web-sessiond`) that owns every Pi session and terminal, and a **web/API server** (`pi-web-server`) that serves the browser UI. The recommended install runs both as per-user services, so sessions survive browser disconnects, SSH logouts and web/API restarts.

- [Requirements](#requirements)
- [Install as user services](#install-as-user-services), including [Termux on Android](#termux-android)
- [Windows](#windows)
- [Other ways to install](#other-ways-to-install): npm, through Pi, Nix and Home Manager, Docker, WSL or manual run
- [Run in a container](#run-in-a-container)
- [CLI reference](#cli-reference)
- [Session daemon ownership and restarts](#session-daemon-ownership-and-restarts)
- [Update](#update)
- [Remote access](#remote-access)
- [Configure](#configure)
- [Uninstall](#uninstall)

## Requirements

- **Node.js 22.19.0 or newer** and npm, set up so `npm install -g` works without `sudo`. A version manager (nvm, fnm, mise) or Homebrew gives you that. A distribution's packaged Node.js installs global packages into a system folder, and `npm install -g` then fails with `EACCES`; either use a version manager, or point npm at a folder you own with `npm config set prefix ~/.local` and put `~/.local/bin` on your login-shell `PATH`. Do not run the installer with `sudo`: the services would be installed for root.
- **On Linux, python3, make and a C++ compiler.** npm builds the terminal's native module (`node-pty`) during the install, because it has no prebuilt binary for Linux. Install them first: `sudo apt install build-essential python3` (Debian, Ubuntu), `sudo dnf install gcc-c++ make python3` (Fedora). Without them `npm install -g` still completes and `pi-web run` works, but without terminals (sessions keep working), and `pi-web doctor` warns about the missing module; the curl installer and `pi-web install` refuse until the module loads. macOS uses the prebuilt binary. On Termux, see [Termux (Android)](#termux-android).
- **Pi Coding Agent 1.3.0 or newer**, configured for your user so the `pi` command works. npm installs the Pi SDK packages PI WEB runs sessions on as its peer dependencies; `pi-web doctor` also expects the `pi` command on your login-shell `PATH`.
- A login shell (bash, zsh or fish) whose `PATH` exposes Node.js, npm, Pi, git and every tool your agents need.
- For `pi-web install`: a per-user service manager, systemd on Linux, launchd on macOS, termux-services on [Termux](#termux-android), or Task Scheduler on Windows (see [Windows](#windows) for its requirements). On Linux the user's systemd needs a session bus; minimal Debian and Ubuntu images leave it out, and the install preflight then fails with `Failed to connect to bus`. Install it with `sudo apt install dbus-user-session`, then start it with `systemctl --user start dbus.socket`.

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

The installer runs `npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty` (the flag only when npm knows it, see [With npm](#with-npm)), installs the preset's packages with `pi install` when asked to, then runs `pi-web install`. Node.js and npm must already be on the host, and for the preset a configured `pi` command too. Before installing anything it checks the [requirements](#requirements) it can see (the Node.js version, that npm can install global packages as your user, and on Linux the build tools) and stops with what to fix. Run `pi-web doctor` afterwards to check the result.

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

Some phones, Samsung's among them, do not let Termux:Boot run at boot until both apps are also exempt from sleeping (on Samsung: **Settings → Battery → Background usage limits → Never sleeping apps**). Until then nothing starts after a restart, `sshd` included; opening Termux starts termux-services, and PI WEB's services start with it.

npm builds `node-pty` from source on Termux, and node-gyp there needs the `android_ndk_path` variable defined. When `~/.gyp/include.gypi` does not exist, the installer writes it with `{'variables':{'android_ndk_path':''}}` and says so; an existing file is never changed. Every later build of `node-pty` uses it, including updates from the Updates page. Delete the file to remove it, and `pi-web` updates then fail to build `node-pty` until it is back.

termux-services restarts a service whenever it exits, not only when it fails, and never forces a stop: a session daemon that takes longer than 180 seconds to drain makes `pi-web restart` report a timeout while the daemon keeps stopping.

A `pi-web uninstall` started inside PI WEB, in one of its terminals or by an agent, would end with the session daemon it stops, so it runs in a detached process of its own and returns; that process writes to `~/.pi-web/logs/uninstall.log`.

### Gang of Beads preset

The preset adds the packages below with user-scope `pi install`, then runs `pi-web install`. It installs the same PI WEB package as the plain installer; there is no separate PI WEB edition or core preset setting. Both installers select it with `PI_WEB_PRESET=gang-of-beads` in the environment, as the [Windows](#windows) command does; `install.sh` also takes `--preset gang-of-beads` and `install.ps1` `-Preset gang-of-beads`.

| Capability | Packages |
|---|---|
| Questions and answers | `@gang-of-beads/pi-ask-user` |
| Subagents | `@gang-of-beads/pi-subagents`, `@gang-of-beads/pi-web-subagents` |
| Background tasks | `pi-background-tasks`, `@gang-of-beads/pi-web-background-runs` |
| Goals | `@gang-of-beads/pi-goal`, `@gang-of-beads/pi-web-goals` |
| Dictation | `@gang-of-beads/pi-web-voice` |
| Extra Web themes | `@gang-of-beads/pi-web-themes` |
| Multiple provider accounts | `@gang-of-beads/pi-multi-account` |
| Pi package updates | `@gang-of-beads/pi-updater` |

Every package installs from npm. The preset uses published releases, not Git checkouts; it is a rolling recommendation, not a version-pinned bundle. The scoped names select the Gang of Beads distributions rather than similarly named upstream packages. See [Packages](plugins.md#packages) for their repositories; the upstream background runtime is maintained by [ismailsaleekh](https://github.com/ismailsaleekh/pi-background-tasks).

Only opt in if you trust these packages: extensions run code with your user's permissions. The installer adds package declarations through Pi; it does not replace your settings file, migrate credentials or accounts, select models, or configure providers. Multi-account still needs your own provider authentication, and dictation needs a speech-to-text service you configure ([pi-web-voice](https://github.com/Gang-of-Beads/pi-web-voice#readme)). `pi-bash-autobg` is not included. Workflows (`pi-dynamic-workflows` with `@gang-of-beads/pi-web-workflows`) are left out for now: on Pi 1.x, its workflow subagents cannot use providers that an extension registers, such as multi-account pools. Install them yourself if your providers come from `auth.json` or `models.json`.

If a package installation fails, the script stops before `pi-web install`; packages already installed remain. Resolve the error and rerun the same command. For an existing installation, follow the normal [package restart and reload rules](plugins.md#install-a-plugin) before expecting all new tools and server plugins to appear. A session-daemon restart can interrupt active sessions; check active work first.

## Windows

On Windows 11 or 10, `pi-web install` registers the services as per-user scheduled tasks that start when you sign in. It needs no administrator rights. To run PI WEB whether or not anyone is signed in, install it to [start at boot](#start-at-boot-without-signing-in) instead.

Requirements:

- **Node.js 22.19.0 or newer and npm** on your user or system `PATH`. The Node.js installer from nodejs.org sets up both, and puts npm's global folder (`%APPDATA%\npm`) on your user `PATH`. No build tools are needed: the terminal's native module ships prebuilt for Windows.
- **Pi Coding Agent**, as on the other platforms, and for the preset a `pi` command on `PATH`.
- **Windows PowerShell 5.1**, which Windows includes, or PowerShell 7.

In PowerShell, with the [Gang of Beads preset](#gang-of-beads-preset):

```powershell
$env:PI_WEB_PRESET = "gang-of-beads"; irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex
```

PI WEB alone:

```powershell
irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex
```

The installer makes the same checks as the curl installer (the Node.js version, that npm can install global packages as your user, and `pi` for the preset), then runs `npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty` (the flag only when npm knows it), the preset's `pi install` commands, and `pi-web install`. It stops at the first failure. Then open <http://127.0.0.1:8504>. Run it in PowerShell opened as administrator if PI WEB starts at boot.

Neither command is subject to PowerShell's execution policy. npm also writes `pi-web.ps1` next to `pi-web.cmd`; if PowerShell later refuses `pi-web` because running scripts is disabled, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or type `pi-web.cmd` instead.

### The scheduled tasks

`pi-web install` registers two tasks at the root of the Task Scheduler library, named after your Windows account: `PI WEB session daemon (<user>)` and `PI WEB server (<user>)`. Each account on the PC that installs PI WEB gets its own pair:

- They start when you sign in to Windows and run hidden, without a console window and without a time limit. They keep running when an SSH session that started them ends, and stop when you sign out. `pi-web install` therefore needs you to be signed in to Windows, at the PC or over Remote Desktop; an SSH session does not count, and without a signed-in session the install stops at once and says so.
- Each runs a launcher in `%LOCALAPPDATA%\pi-web\services` (`sessiond.ps1`, `web.ps1`). The launcher sets the recorded environment, starts the service, appends its output to `~/.pi-web/logs/sessiond.log` or `web.log`, and starts it again two seconds after it fails.
- They get `PATH` from your user and system environment variables (**System Properties → Environment Variables**), not from a PowerShell profile or the window you installed from. Put the folders of node, npm, pi and your agents' tools there, then run `pi-web restart`.
- The launcher runs each service through `cmd.exe`, which expands a `%name%` pair even inside quotes, so a path that reaches it must not contain two `%` signs.
- The session daemon's named pipe keeps Windows' default access, so other local accounts on the PC can connect to it. Install PI WEB only on a PC whose other accounts you trust.

`pi-web status`, `start`, `stop`, `restart`, `logs`, `doctor` and `version` work as on the other platforms; `pi-web logs` follows the two log files. After a [start-at-boot install](#start-at-boot-without-signing-in), `start`, `stop` and `restart` need PowerShell opened as administrator. `pi-web install --dev` is not supported on Windows.

Stopping a task ends its processes at once: Windows has no stop signal the session daemon could drain on, so agent runs still in flight are interrupted. A `pi-web restart` started inside PI WEB, in one of its terminals or by an agent, runs inside the session daemon it restarts, so it hands the restart to a short-lived `PI WEB restart (<user>)` task and returns; that task writes to `~/.pi-web/logs/restart.log` and removes itself, also when it could not be started. When PI WEB [starts at boot](#start-at-boot-without-signing-in), the task stays registered for the next restart. A restart from the Updates page of another machine, or of this one, uses the same task, and is refused when the PI WEB tasks are not installed. Every restart from the Updates page restarts both services, so it offers **Restart session daemon** only, not **Restart web**. Applying an update from the browser is not available on Windows yet, and a saved update command is not offered there; update as below.

To update, close PI WEB in your browser and run these in a PowerShell window outside PI WEB, opened as administrator if PI WEB starts at boot. The running services hold the terminal's native module open, and npm cannot replace it while they run:

```powershell
pi-web stop
npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty
pi-web start
```

`pi-web uninstall` stops and removes both tasks and their launchers, and the `PI WEB restart (<user>)` and `PI WEB uninstall (<user>)` tasks when they are not running, whether a start-at-boot install registered them or a failed run left them behind. Started inside PI WEB, it hands the work to a short-lived `PI WEB uninstall (<user>)` task, as a restart does, and returns; the task writes to `~/.pi-web/logs/uninstall.log`. It keeps the npm package, the config file (`~/.config/pi-web/config.json`) and the data directory (`~/.pi-web`).

### Start at boot without signing in

After the PC restarts, the default tasks wait for you to sign in. To keep PI WEB running whether or not anyone is signed in, the Windows counterpart of `loginctl enable-linger` on Linux, install it from an administrator account, in PowerShell opened as administrator outside PI WEB:

```powershell
pi-web install --at-boot
```

- The two tasks start when Windows starts, as your account, without a stored password (Task Scheduler's **Run whether user is logged on or not** with **Do not store password**).
- The install needs PowerShell opened as administrator, and your account needs the **Log on as a batch job** right, which administrator accounts have. It runs its preflight checks as such a task, so it reports either missing requirement before it changes anything.
- The tasks run with your full administrator rights, and so do PI WEB's terminals and agents: Windows does not limit tasks that run without a sign-in, as it limits an ordinary PowerShell window. For that reason `pi-web stop`, `start`, `restart`, `uninstall` and `install` need PowerShell opened as administrator, and refuse in an ordinary window before they change anything. To restart, the Updates page and `pi-web restart` in a PI WEB terminal also work, and `pi-web uninstall` works in a PI WEB terminal. `pi-web status`, `logs` and `doctor` work in any window. Any program running as your account, even in an ordinary window, can use PI WEB's tasks and files to get full administrator rights without a UAC prompt; use `--at-boot` only where that is acceptable.
- Without a stored password the services, and the terminals and agents they run, have no network credentials: mapped drives and network shares are not available to them as you. Local files and outbound connections, such as model APIs and Tailscale, work. They run without a desktop.
- A later `pi-web install` keeps the start mode, unless you uninstalled. Switching the mode with `--at-boot` or `--at-log-on` is refused in a PI WEB terminal. `pi-web status` and `pi-web doctor` show the installed mode; `pi-web doctor` checks the tasks' context only from PowerShell opened as administrator, and elsewhere reports that check as not verified.
- `pi-web install --at-boot` also registers the `PI WEB restart (<user>)` and `PI WEB uninstall (<user>)` tasks, which a restart or uninstall started inside PI WEB, or from the Updates page, starts. If one of them is missing, `pi-web install` from PowerShell opened as administrator registers it again.
- A PC that sleeps stops serving; set its power options so it stays awake if PI WEB must stay reachable.

To start PI WEB when you sign in again, run `pi-web install --at-log-on` from PowerShell opened as administrator outside PI WEB while you are signed in to Windows; it also removes the restart and uninstall tasks when they are not running.

## Other ways to install

### With npm

The installer's steps, run by hand:

```bash
npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty
pi-web install
pi-web doctor
```

The scoped `--allow-scripts=node-pty` flag lets npm 12 run the native-module build that PI WEB terminals need, without enabling install scripts for other dependencies. npm 11.15 and later know the option too. npm 11.6 to 11.14 warn `Unknown cli config "--allow-scripts"` about it and npm 10 accepts it silently; neither needs it, so the installers, the Updates page and `pi-web doctor` leave it out there. The Updates page asks the npm that PI WEB itself finds; if your interactive shell uses a different npm (a version manager loaded only in interactive shells) and that one is npm 12, run the update there yourself with `--allow-scripts=node-pty`.

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

On WSL without systemd, or anywhere else `pi-web install` is not supported, run both processes in the foreground with one command:

```bash
npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty
pi-web run
```

Or run the two processes yourself:

```bash
# Terminal 1
pi-web-sessiond

# Terminal 2
PI_WEB_PORT=8504 pi-web-server
```

A terminal that closes ends `pi-web run` and both processes, as it ends any program started in it; over SSH, keep it in tmux or screen, or start it detached with `setsid -f pi-web run > ~/pi-web-run.log 2>&1`. On WSL distributions with systemd enabled, `pi-web install` can work. In a container, see [Run in a container](#run-in-a-container).

## Run in a container

Use this to run PI WEB as one application container on a platform that starts and stops it for you (Kubernetes, a PaaS, a cloud development environment). The [Docker setup](../docker/README.md) is the other option: a beta two-container Compose setup with deliberate access to the Docker host.

### `pi-web run`

`pi-web run` is the container's entrypoint. It starts the session daemon, waits until the daemon answers its health check (up to 120 seconds), then starts the web/API server, and stays in the foreground until both stop. It takes no options: the [environment and config](config.md) choose the host, port and directories as for any other run. Both processes write their JSON log lines to the container log; its own lines start with `pi-web run:`.

- **Stop:** SIGTERM or SIGINT is passed to both processes as SIGTERM, and the session daemon drains in-flight agent runs for up to `PI_WEB_SHUTDOWN_DRAIN_MS` (60 seconds by default). A second signal kills both at once.
- **The web/API server exits:** it is started again while sessions keep running: after 1 second, and after 2, 4, 8 seconds and so on, up to 30 seconds, while it keeps exiting. The delay starts over at 1 second once a web/API server has stayed up for 60 seconds. After 5 exits within 60 seconds, `pi-web run` stops the session daemon and exits.
- **The session daemon exits:** its sessions are gone, so `pi-web run` stops the web/API server and exits, and the platform restarts the container.
- **Exit status:** `0` after a requested stop in which both processes stopped cleanly, `1` after a failure (a process exited, the daemon did not become ready, or the drain failed), `2` for an argument it does not take. Windows is not supported yet and exits with `2`.

Node.js does not reap orphaned processes, and agents leave some behind, so run `pi-web run` under an init: `docker run --init`, or `ENTRYPOINT ["tini", "--"]`. `pi-web run` warns when it is PID 1.

### Image

A Debian-based Node.js image works. npm builds `node-pty` there, so install the build tools in a build stage and copy the installed package into a slim final stage:

```dockerfile
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty && npm cache clean --force

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git tini ca-certificates openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/home /workspace && chown -R node:node /data /workspace
COPY --from=build /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=build /usr/local/bin /usr/local/bin
RUN ln -sf ../lib/node_modules/@gang-of-beads/pi-web/node_modules/.bin/pi /usr/local/bin/pi
ENV HOME=/data/home PI_WEB_SESSIOND_SOCKET=/tmp/pi-web/sessiond.sock PI_WEB_SHUTDOWN_DRAIN_MS=20000
USER node
WORKDIR /workspace
EXPOSE 8504
ENTRYPOINT ["tini", "--"]
CMD ["pi-web", "run"]
```

The `node` user (uid 1000) runs PI WEB and must be able to write the volumes: a new Docker volume copies the ownership of `/data` and `/workspace` from the image, a Kubernetes volume needs `securityContext.fsGroup: 1000`, and a bind mount needs `chown 1000:1000` on the host directory.

Without the build tools the install still completes, and PI WEB runs without terminals: no shells, and nothing that runs in one, such as the Updates page's update and restart buttons and a workspace removal that runs a command. Sessions keep working. The final stage links the `pi` command that comes with PI WEB onto `PATH`, where agents and `pi-web doctor` look for it. Add the tools your agents need to the final stage.

### Persistent storage

Everything PI WEB and Pi keep hangs off `HOME`, so put `HOME` on a volume, together with the projects:

| State | Default | Override |
| --- | --- | --- |
| PI WEB data: projects, machines, pins, unread marks, plugins and their storage, logs | `~/.pi-web` | `PI_WEB_DATA_DIR` |
| Global config, written by **Settings** | `~/.config/pi-web/config.json` | `PI_WEB_CONFIG` |
| Pi's agent directory: provider credentials, settings, session transcripts, Pi packages | `~/.pi/agent` | `PI_CODING_AGENT_DIR` |
| Tools agents use: `~/.gitconfig`, `~/.ssh`, `~/.config/gh` | `HOME` | `HOME` |
| Repositories and worktrees | wherever the projects are | none |

The session daemon's socket is not state. Keep it off the volume: some volumes (SMB/CIFS, some FUSE mounts) cannot hold a socket, and a socket path is limited to 107 bytes. Set `PI_WEB_SESSIOND_SOCKET=/tmp/pi-web/sessiond.sock` in the container's environment rather than only for `pi-web run`, so `pi-web doctor` run inside the container finds it too. A container's `/tmp` is its own; on a host shared with other users, put the socket in a directory only you can write, such as `$XDG_RUNTIME_DIR`, because the socket has no authentication. Terminals live in memory and end with the session daemon, as on any host. A read-only root filesystem works when `/tmp` and the volume are writable.

### One session daemon per data directory

Two session daemons on one data directory corrupt it. Run one replica: `replicas: 1` with `strategy: Recreate`, or a StatefulSet, never a rolling update that starts the new container before the old one stops. [Session daemon ownership and restarts](#session-daemon-ownership-and-restarts) describes how the daemon claims its data directory.

### Probes and stopping

A platform's HTTP and TCP probes connect to the container's own address, not to loopback, so they fail while the web/API listens on `127.0.0.1`, the default. Use exec probes, which run inside the container; the image has no curl, so let Node.js make the request:

- **Readiness and startup:** `GET /api/sessiond/health` answers `200` only when the session daemon does:

  ```yaml
  readinessProbe:
    exec:
      command: ["node", "-e", "fetch('http://127.0.0.1:8504/api/sessiond/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
  ```

- **Liveness:** the same command with `/manifest.webmanifest`, which the web/API serves whatever the session daemon is doing. Do not use the daemon's health for liveness: a long drain or a slow start would get the container killed mid-run.

HTTP and TCP probes on the web port work only when it listens beyond loopback (`PI_WEB_HOST=0.0.0.0`, with the exposure that brings; see [Bind and publish](#bind-and-publish)).
- **Grace period:** set the platform's stop timeout to at least the drain plus 10 seconds: 30 seconds with the image above, 70 with the default drain of 60 seconds (Docker's default stop timeout is 10 seconds, Kubernetes' 30). Or lower `PI_WEB_SHUTDOWN_DRAIN_MS`. A run cut short by a forced stop is reported when the daemon starts again.

### Bind and publish

The web/API server listens on port 8504 (`PI_WEB_PORT`, or `PORT` as many platforms set it) and on `127.0.0.1` unless `PI_WEB_HOST` says otherwise, and a platform's ingress usually needs `PI_WEB_HOST=0.0.0.0`. PI WEB has no login: anyone who reaches the port runs agents and shells as the container's user. Publish it only behind authentication, such as the platform's authenticating ingress or port forwarding, a private network (Tailscale), or an [authenticating reverse proxy](#reverse-proxy-at-the-root-or-under-a-path-prefix). `pi-web doctor` says when the bind address is not loopback.

### Check and update

`pi-web doctor` inside the container (not in the bundled [Docker setup](../docker/README.md), whose doctor skips these checks) checks that the data, config and agent directories are writable, that the socket's directory accepts a socket, what runs as PID 1 and the bind address, and prints how to run PI WEB. To update, deploy an image with the newer package; the Updates page says so instead of offering a command. Your own [update command](config.md#updates), when you set one, is offered there and runs in a terminal of this machine; the fleet **Update** in **Settings → Machines** refuses to start it under `pi-web run`, as **Restart** does, because no service manager runs these processes.

## CLI reference

| Command | What it does |
| --- | --- |
| `pi-web install [--dev] [--host H] [--port P] [--config PATH]` | Check the requirements, write the config file if it does not exist, and install and start the services |
| `pi-web uninstall` | Stop, disable and remove the production and development service files |
| `pi-web start` / `stop` / `restart` | Start, stop or restart the installed services |
| `pi-web status` | Show the state of each installed service |
| `pi-web logs` | Follow the service logs: `journalctl --user` on Linux; `~/.pi-web/logs/sessiond.log` and `web.log` on macOS, Termux and Windows |
| `pi-web run` | Run the session daemon and the web/API server in the foreground, without a service manager; see [Run in a container](#run-in-a-container) |
| `pi-web doctor` | Check the login-shell environment, the service plan (or, without a service manager, what a manual run needs), the `node-pty` native module, the installed and running versions, the [HTTPS certificate](#serve-https-directly) when one is configured, and whether an [access token](#require-an-access-token) is required |
| `pi-web version` | Compare the installed package version with the versions the running services report |
| `pi-web --version` | Print the installed package version |
| `pi-web plugins disable <plugin-id>` | Disable a PI WEB plugin offline; see [Offline disable and safe start](config.md#offline-disable-and-safe-start) |
| `pi-web plugins safe-start show\|clear\|set <bundled-only\|none>` | Start the session daemon without external server plugins; same section |

`pi-web install` flags:

- `--host` (default `127.0.0.1`) and `--port` (default `8504`) apply only when the install creates the config file. Once it exists, edit `host` and `port` in the config file or in **Settings → General** instead.
- `--config PATH` uses another global config file (default `$XDG_CONFIG_HOME/pi-web/config.json`, or `~/.config/pi-web/config.json`) and records it in the services as `PI_WEB_CONFIG`.
- `--at-boot` and `--at-log-on`, on Windows only, choose whether the tasks [start at boot](#start-at-boot-without-signing-in) or when you sign in (the default). A later install keeps the installed choice.
- `--dev`, run from a PI WEB checkout, installs the development services instead: a session daemon that runs from the checkout without reloading, and one service for the web/API server and the Vite UI, which reload when the code changes. The UI is then at <http://127.0.0.1:8505>; it listens on every interface (`0.0.0.0`) without authentication, so use `--dev` only on a network you trust. The Updates page and **Settings → Machines** offer no restart or update for the development services, because their PI WEB processes run under `pnpm` and cannot confirm they are the services' own. Restart them with `pi-web restart` from the checkout, and update with `git pull --ff-only && pnpm install --frozen-lockfile` followed by `pi-web restart`.

### What `pi-web install` writes

- **Service definitions:** `~/.config/systemd/user/pi-web-sessiond.service` and `pi-web.service` (and `pi-web-ui-dev.service` with `--dev`) on Linux; `~/Library/LaunchAgents/com.pi-web.sessiond.plist` and `com.pi-web.web.plist` (and `com.pi-web.ui-dev.plist`) on macOS; the `run` scripts in `$PREFIX/var/service/pi-web-sessiond` and `pi-web` (and `pi-web-ui-dev`) plus the boot script `~/.termux/boot/pi-web-services` on Termux; the `PI WEB session daemon (<user>)` and `PI WEB server (<user>)` scheduled tasks and their launchers in `%LOCALAPPDATA%\pi-web\services` on Windows, and with `--at-boot` also the `PI WEB restart (<user>)` and `PI WEB uninstall (<user>)` tasks.
- **Logs:** on macOS, Termux and Windows the services write to `~/.pi-web/logs`; on Linux their output goes to the journal.
- **Out-of-memory policy:** on Linux the session daemon unit sets `OOMPolicy=continue`, as does the [Home Manager module](#home-manager-module)'s. When the kernel's out-of-memory killer ends a program an agent started, the session daemon and its other sessions keep running. It needs systemd 243 or later; older systemd ignores the setting. An existing install gets it the next time `pi-web install` runs; `npm install -g` and `pi-web restart` leave the unit as it is.
- **Recorded environment:** a service manager does not inherit your shell's environment. The installer records `PI_WEB_LOG_DIR`, `PI_WEB_CONFIG` when `--config` is given, and `PI_WEB_UPDATE_COMMAND` when it is set in the installing shell. Other variables are not captured.
- **Command overrides:** set `PI_WEB_SERVER_EXEC` or `PI_WEB_SESSIOND_EXEC` when you run `pi-web install` to start the services with your own command instead of `pi-web-server` or `pi-web-sessiond`.

## Session daemon ownership and restarts

The session daemon is the long-lived owner of PI WEB's session runtime. It hosts every Pi session, and everything an agent spawns (bash tools, terminals, subsessions) inherits its environment. At startup it claims the instance's state: the data directory (`~/.pi-web`, or `PI_WEB_DATA_DIR`) and the socket in it (`~/.pi-web/sessiond.sock`, a named pipe derived from the data directory on Windows, or `PI_WEB_SESSIOND_SOCKET`). A second daemon started against the same data directory, on this machine or in another container that mounts it, finds the live owner and exits with an error naming what it needs. The web/API server of the same instance shares the data directory without claiming it.

Restart the web/API server first, then the session daemon, and restart the daemon only when a change needs it: it owns running sessions and terminals. Service managers briefly overlap the outgoing and incoming daemon; the startup claim waits a short grace period for the previous daemon to let go, so a normal service restart does not trip the ownership error.

### Restart the session daemon

| Install | Command |
| --- | --- |
| `pi-web install` on Linux | `systemctl --user restart pi-web-sessiond` |
| `pi-web install` on macOS | `launchctl kickstart -k gui/$(id -u)/com.pi-web.sessiond` |
| `pi-web install` on Termux | `sv -w 180 restart $PREFIX/var/service/pi-web-sessiond` |
| `pi-web install` on Windows | `pi-web restart` (restarts both services; see [Windows](#windows)) |
| Docker | `restart-sessiond`, see [docker/README.md](../docker/README.md) |
| `pi-web run` | Restart the container, or stop `pi-web run` and run it again |
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

Set `PI_WEB_CONFIG` to a separate file as well, or both instances share plugin, path-access and other settings. `pi-web install` manages one instance per user. The Updates page offers **Restart web** and **Restart session daemon** only to a process the installed service started itself (on systemd, launchd and termux-services; a session daemon that does not report which service it runs under counts as started by its service when the web/API process is). **Restart** in **Settings → Machines** needs both, and an update command a second instance inherits as `PI_WEB_UPDATE_COMMAND` from the installed services is not offered either. A second instance started by hand therefore says to restart it the way it was started instead of restarting the installed one; an update command saved in its own config is still offered. The development services get no restart or update button either; see `--dev` under [CLI reference](#cli-reference). Containers sharing a volume are instances too; see [Run in a container](#one-session-daemon-per-data-directory).

Processes spawned inside PI WEB inherit the daemon's `PI_WEB_*` values and `PI_WEB_SESSION=1`, so an instance started from inside a session with those inherited values fails at startup instead of taking over the running one.

A second instance in another container needs its own data directory as well; see [Containers sharing a data directory](#containers-sharing-a-data-directory).

### Containers sharing a data directory

One session daemon uses a data directory at a time, also when the directory sits on a volume that several containers or hosts mount. Run a single replica and replace it with the `Recreate` strategy, or use a StatefulSet; a rolling update starts the new container while the old one still runs.

A daemon in another container cannot see the owner's process, so the owner records its host and PID namespace in `sessiond-owner.json` and rewrites a heartbeat there every 10 seconds. A daemon that starts and finds the marker of a daemon in another container:

- exits with an error naming the other host when the heartbeat keeps changing: that daemon is running;
- takes over when the heartbeat has not changed for 30 seconds: that daemon is gone.

A daemon that stops cleanly removes its marker, so the next container starts at once. After a crash, or when the platform kills the daemon before its [shutdown drain](#restart-the-session-daemon) ends, the next container waits about 30 seconds before it starts. A container that restarts in place after a crash or `docker kill` counts as another container here: its new daemon runs in a new PID namespace, which PI WEB tells apart by the start time of the container's first process even when the kernel reuses the namespace number. A daemon that cannot read that start time, or the boot id, because `/proc` is restricted, is judged by its process id instead, as on an ordinary host. The starting daemon times the heartbeat on its own clock, so the hosts' clocks need not agree. A daemon in a container also checks its claim again about 1 second after it writes it, so two containers that claim the directory at the same moment cannot both keep it. Other Linux systems that run in their own PID namespace count as containers too: ChromeOS Linux (Crostini), LXC, Incus, Proxmox and NixOS containers, and Flatpak or firejail sandboxes. They make the 1 second check at every start and wait about 30 seconds after an unclean stop, also when a reboot follows it; a clean stop or a clean reboot removes the marker, so the next start does not wait.

A daemon on an ordinary host starts as before, without that check: on Linux outside any container, on macOS, on Windows, and in a WSL distro. On Linux and in WSL it takes over at once when the daemon its machine left behind is gone, also after a reboot, and in WSL also after `wsl --shutdown` or a Windows restart. It recognises its own machine by `/etc/machine-id`, which the marker records only as a hash keyed for PI WEB, so a changed hostname does not matter; on a system without `/etc/machine-id` it uses the hostname instead, and a hostname that changed across an unclean stop and a reboot then costs the 30 second wait. A WSL distro restarted while the WSL VM keeps running (another distro or Docker Desktop holds it) takes over at once only when both runs recorded a machine id, in practice a distro with systemd; otherwise it waits the 30 seconds. PI WEB recognises a WSL distro by its kernel and its `/run/WSL` directory; a WSL version without that directory keeps the 1 second check. Containers on the WSL kernel, such as Docker Desktop's, keep the check too. On macOS and Windows the daemon judges the marker by its process id alone, as before.

Never sync a data directory between hosts (Syncthing, Dropbox, Unison or the like), whatever the system: each host then has its own copy of the marker, and the daemons refuse to start or stop each other, with their sessions, whenever a copy arrives. Hosts can only share one directory that they all mount, and only Linux hosts with different machine ids can share one under this check. Two macOS or Windows hosts, or two Linux systems cloned with the same machine id, must never share one: each starting daemon reads the other's process as gone and takes the directory over, and the other exits with its sessions at its next heartbeat, again and again.

Hosts that share a directory also need the session daemon socket off the shared volume: a socket on NFS only connects processes on the same host, and SMB cannot hold one at all. Set `PI_WEB_SESSIOND_SOCKET` to a path in your own runtime directory, such as `$XDG_RUNTIME_DIR/pi-web/sessiond.sock` (`/run/user/<uid>`, readable only by you); a shared directory such as `/tmp` lets another user on the host remove or replace the socket. The bundled Docker setup keeps its socket on its data volume and is meant for one host; see [docker/README.md](../docker/README.md#sharing-runtime-and-development-state).

On a network volume the lease needs every host to see the owner's heartbeat within 30 seconds, so mount it with attribute caching of 10 seconds or less (`actimeo=10`, or `noac`, on NFS); with a longer cache, two daemons can each go on reading their own claim.

Give the daemon time to finish its drain when the platform stops it: allow the drain (60 seconds by default, `PI_WEB_SHUTDOWN_DRAIN_MS`) plus 10 seconds, so 70 seconds by default. The bundled Docker setup sets this as its `stop_grace_period`; its [README](../docker/README.md#sharing-runtime-and-development-state) says how an existing install picks it up. With `docker run`, pass `--stop-timeout 70`; on Kubernetes, set `terminationGracePeriodSeconds: 70`. If you raise or lower the drain, change these by the same amount.

Let startup, readiness and liveness probes allow for the wait after a crash: the 30 second lease, the 1 second check and the daemon's own startup, about 60 seconds in all. A probe that restarts the container sooner starts the 30 seconds over every time, and the container never recovers.

A heartbeat the owner cannot write is logged, and the owner retries it on the next beat; a marker it finds missing it writes back. Once the volume has refused writes for 30 seconds, a starting daemon reads the owner as gone and takes over. The owner finds the other daemon recorded in the marker at its next heartbeat, within 10 seconds of the takeover, and then stops serving at once and exits with an error naming that daemon, without waiting for its sessions to finish. This also cuts a shutdown drain short when the takeover happens while the owner is stopping. A volume that refuses writes for longer than the lease therefore costs the running daemon its sessions, and while the new owner runs, a service manager that restarts the old daemon sees it exit again with the conflict error each time.

Every daemon that mounts the volume must run a PI WEB version with this check: an older daemon judges another container's owner by its process id alone and can take over a running one.

## Update

- **npm global install:** `npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty`, then `pi-web restart`. The Updates page offers the same update (with the flag when npm knows it) where systemd, launchd or termux-services runs PI WEB; on Linux without systemd and on Windows it says how to update instead. If the `node-pty` build fails during the update, the update still completes and PI WEB restarts without terminals; `pi-web doctor` warns about it. On Windows, stop the services first; see [Windows](#windows).
- **Your own update command:** set `updateCommand` in **Settings → General → Updates** (or `PI_WEB_UPDATE_COMMAND` in the services) and the Updates page runs it; see [Updates](config.md#updates).
- **Nix:** upgrade the profile or switch your Home Manager configuration to a newer tag, then restart the services.
- **Container:** deploy an image with the newer package; see [Run in a container](#check-and-update).
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

### Require an access token

An access token is a second layer on top of a private network or an authenticating proxy, not a replacement for them. When a token is configured, the web/API serves only its sign-in page and the PWA metadata (`manifest.webmanifest` and the icons) to a request without a valid token or sign-in cookie. Everyone who holds the token is the same user: there are no accounts, no per-person permissions and no audit. If you must publish PI WEB beyond a private network, use HTTPS and the token together.

Generate a token of at least 32 characters with no whitespace:

```bash
openssl rand -base64 32
```

Then configure it in one of three ways and restart the web/API. The session daemon is not involved and keeps its sessions running.

- `PI_WEB_ACCESS_TOKEN`: one token, for containers and `pi-web run`.
- `PI_WEB_ACCESS_TOKEN_FILE`: a file with one token per line; blank lines and lines starting with `#` are skipped. Use it with Docker or Kubernetes secrets.
- `access.tokenFile` in the [global config](config.md#config-files): the path of such a file, never the token itself. Use it for native installs, whose services do not inherit your shell's environment.

```json
{
  "access": { "tokenFile": "~/.config/pi-web/access-tokens" }
}
```

Keep the file readable only by you (`chmod 600`). Agents and terminals run as the same user and can read it; the session daemon keeps `PI_WEB_ACCESS_TOKEN` out of their environment, which is hygiene, not a boundary. `PI_WEB_ACCESS_TOKEN_FILE` wins over `access.tokenFile`; setting `PI_WEB_ACCESS_TOKEN` together with a file is refused as ambiguous. If a configured source is empty, unreadable, or holds a token shorter than 32 characters or one containing whitespace, the web/API refuses to start and logs the variable or path, never the token. `pi-web doctor` checks the same source.

**Signing in.** A browser without a cookie is sent to the sign-in page, which asks for the token once; password managers can store it. The sign-in cookie is `HttpOnly`, lasts 30 days and is renewed each day you use PI WEB, so only 30 days without use end it. **Settings → General → This browser → Sign out** removes this browser's cookie. To end the sign-in of a device you no longer have, remove the token it signed in with (see rotation below): every cookie signed with that token stops working. Over plain HTTP to a name that is not loopback, the sign-in page warns that the token travels unencrypted unless the network encrypts it, as a tailnet or WireGuard does. The installed iPhone or iPad app keeps its own cookies, so sign in once inside the app.

**Programs and other machines.** Send the token as `Authorization: Bearer <token>`, or as `X-PI-WEB-Access-Token: <token>` when an authenticating proxy in front of PI WEB already uses `Authorization`. A token in a query string is never accepted. A gateway reaches a gated machine with **This server** and the token; see [Machines](machines.md#this-browser-or-this-server). `pi-web version`, `pi-web restart` and `pi-web doctor` read the token from the same environment and config as the web/API.

**Rotating the token** without downtime:

1. Add the new token as a new line of the token file and restart the web/API.
2. Move the clients over: gateways' machine entries, scripts and probes, password managers.
3. Delete the old line and restart again. Browsers that signed in with the old token are signed out; keeping only a fresh token signs every browser out.

**Reverse proxies and probes.** Nothing needs configuring for a path prefix: the cookie follows the prefix the browser used. A plain-HTTP proxy must pass the browser's `Host` header through, including its port (nginx: `proxy_set_header Host $http_host;`, not `$host`, which drops a non-default port), or set `X-Forwarded-Host` to it: without Fetch Metadata, the sign-in form is accepted only when its `Origin` names the host PI WEB was asked for. A proxy in front of a gated PI WEB should not inject its own `Authorization` header: PI WEB reads it as a token, and wrong tokens count toward the limits below. Page loads judge only the sign-in cookie, so a signed-out reader still reaches the sign-in page, but the app's API requests carry the header too. Use `GET manifest.webmanifest` or a TCP check for liveness, and `GET /api/sessiond/health` with the bearer header for readiness. Wrong tokens and forged cookies are limited to 20 failures per client address and 200 in total every 10 minutes. Past either limit, token guesses and new sign-ins are refused until the window ends. Anyone who can reach the port can use this to make programs that send a token, readiness probes that send one, and new sign-ins wait: from at least ten addresses, or from one behind a reverse proxy, where every client shares the proxy's address. Browsers that are already signed in are not affected. This is one more reason to keep the port on a private network.

### Install on iPhone or iPad

Open PI WEB in Safari, choose **Share → Add to Home Screen**, then **Add**. On iOS 26, Share may sit under the **⋯** button. The installed app opens in standalone mode. For remote access, serve PI WEB with [Tailscale Serve](#remote-access) or another HTTPS reverse proxy on a trusted VPN or private network.

The installed app is a control surface for the sessions on the server, so it needs a live connection. It does not cache the application for offline use.

### Install on Android

Open PI WEB over HTTPS in Chrome, Edge or Samsung Internet, open the browser menu, then choose **Install app** or **Add to Home screen**. The installed app opens in standalone mode, like on iPhone.

### The install offer

On a phone or tablet that is not running PI WEB as an installed app, PI WEB offers to install it in a dialog, the way it offers an update. The dialog opens by itself at most once per page load, after the page has restored the view it opened on, and waits while another dialog is open. Where the browser offers an install prompt (Chrome, Edge and Samsung Internet on Android), **Install** opens it. On iPhone and iPad the dialog shows the Share steps above, with a **Share** marker where the browser's Share button usually is; in other browsers it shows the browser-menu steps and switches to **Install** if the browser offers its prompt later. On a plain-HTTP address, iPhone and iPad still show the Share steps, because Safari can add such a page to the Home Screen, with a line that PI WEB works better over HTTPS, which some features need; other phones and tablets are told that installing needs HTTPS. Both link to [Remote access](#remote-access).

**Later** hides the offer for 7 days; closing the dialog with ×, Escape, a tap outside it or the back gesture counts as Later, and so does dismissing the browser's install prompt. **Don't show again** hides it for good, in that browser only. To bring it back, clear the browser's site data for the PI WEB address; this also clears the drafts and settings that browser keeps for PI WEB.

The browser keeps the choice per address, so the `http://` and `https://` addresses of the same host each remember their own: after you set up HTTPS, the offer shows once more on the new address. A browser that blocks site storage cannot keep the choice at all and shows the offer on every page load.

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

`pi-web uninstall` stops, disables and removes PI WEB's production and development services, and on Termux its boot script; there it also releases the wake lock with `termux-wake-unlock`. It keeps the npm package, the config file and the data directory. The commands below are for Linux, macOS and Termux; on Windows, run `pi-web uninstall` and `npm uninstall -g @gang-of-beads/pi-web` in PowerShell, opened as administrator if PI WEB starts at boot, then delete the same config file and data directory.

```bash
pi-web uninstall
npm uninstall -g @gang-of-beads/pi-web
```

Started inside PI WEB, in one of its terminals or by an agent, `pi-web uninstall` would end with the session daemon it stops, so it hands the work to a process outside PI WEB's services and returns: on Linux the transient systemd user unit `pi-web-uninstall.service`, on macOS the one-shot LaunchAgent job `com.pi-web.uninstall`. Both end when the uninstall does and write to `~/.pi-web/logs/uninstall.log`. If that unit or job cannot be started, `pi-web uninstall` changes nothing and says so; run it from a terminal outside PI WEB, such as an SSH session. On a Linux host without a user service manager, such as WSL without systemd, it always refuses inside PI WEB; run it outside. In a [Docker](#docker) deployment it runs in place.

Because it returns at once there, the work is still going on when the next command starts. Before `npm uninstall -g`, wait until `~/.pi-web/logs/uninstall.log` says the services were removed or `pi-web status` finds no PI WEB service files, or run `npm uninstall -g` from a terminal outside PI WEB.

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
