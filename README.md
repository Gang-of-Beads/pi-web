# PI WEB

English | [简体中文](README.zh-CN.md)

[![Release](https://github.com/Gang-of-Beads/pi-web/actions/workflows/publish.yml/badge.svg)](https://github.com/Gang-of-Beads/pi-web/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/@gang-of-beads/pi-web)](https://www.npmjs.com/package/@gang-of-beads/pi-web)
[![Node.js](https://img.shields.io/node/v/@gang-of-beads/pi-web)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**PI WEB is a web UI for [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) that keeps agent sessions running in real workspaces on your machine or server.**

Run agents where your code, tools, credentials and build caches live. Supervise them from any browser.

![PI WEB](docs/assets/pi-web-banner.png)

https://github.com/user-attachments/assets/e3ddcbbe-4746-4182-a8b4-9f479e465740

![PI WEB on a desktop: sessions, a conversation and the project's files](docs/assets/pi-web-desktop.png)

<p align="center">
  <img src="docs/assets/pi-web-mobile.png" alt="The session board on a phone" width="32%">
  <img src="docs/assets/pi-web-mobile-goto.png" alt="The Go to menu on a phone" width="32%">
  <img src="docs/assets/pi-web-mobile-light.png" alt="A conversation on a phone in Material Light" width="32%">
</p>
<p align="center"><em>On a phone: the session board, the Go to menu, and a conversation in the light theme.</em></p>

## Why PI WEB?

Agentic development works better when the work environment is persistent. PI WEB lets you:

- keep Pi Coding Agent sessions alive after browser disconnects;
- run agents inside real repositories and git worktrees;
- supervise several sessions in parallel;
- switch between laptop, phone, tablet and desktop;
- use a server, workstation or remote dev box as your agent runtime;
- manage projects, workspaces, files, terminals, sessions and other machines from one web UI.

Your browser is the control surface. The work stays where it can keep running. See [Remote-first development](docs/remote-first.md).

## Quick start

Requirements:

- Node.js 22.19.0 or newer, and npm, on your login-shell `PATH` and able to `npm install -g` without `sudo`; see [Requirements](docs/install.md#requirements) for nvm and distribution packages
- Pi Coding Agent 1.3.0 or newer, configured for your user
- git and the development tools your agents need; on Linux also python3, make and a C++ compiler (for example `build-essential`), which npm uses to build the terminal
- Linux or macOS with a per-user service manager (systemd or launchd), Windows 10 or 11 (per-user scheduled tasks), or [Termux on Android](docs/install.md#termux-android) (termux-services)

### Recommended setup

Run PI WEB with the Gang of Beads preset on the machine where your code lives, publish it to your tailnet with Tailscale Serve, and use it from your phone.

1. Install PI WEB as per-user services, with the agent tools and Web plugins of the [Gang of Beads preset](docs/install.md#gang-of-beads-preset):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.sh | sh -s -- --preset gang-of-beads
   ```

   On a Linux server, also run `sudo loginctl enable-linger "$USER"` so the services keep running after you log out.

   On Windows, run this in PowerShell instead:

   ```powershell
   $env:PI_WEB_PRESET = "gang-of-beads"; irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex
   ```

2. Publish it to your tailnet with [Tailscale Serve](docs/install.md#remote-access) (MagicDNS and HTTPS certificates enabled). PI WEB stays on loopback, and your devices get the HTTPS that dictation and the clipboard need:

   ```bash
   tailscale serve --bg --https=8504 http://127.0.0.1:8504
   ```

3. On your phone, signed in to the same tailnet, open `https://<machine>.<tailnet>.ts.net:8504` and add it to the Home Screen (Safari: **Share → Add to Home Screen**). It opens as an app: see [Install on iPhone or iPad](docs/install.md#install-on-iphone-or-ipad).

PI WEB alone, without the preset:

```bash
curl -fsSL https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.sh | sh
```

On Windows, in PowerShell ([Windows](docs/install.md#windows) has the details):

```powershell
irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex
```

Then open <http://127.0.0.1:8504>, or publish it as in step 2.

npm, Nix, Home Manager, Docker, installing through Pi, WSL and manual runs: see the [installation guide](docs/install.md).

Everyday commands:

```bash
pi-web status
pi-web logs
pi-web restart
pi-web doctor
pi-web version
pi-web uninstall
```

## Core model

```text
Machine     a PI WEB runtime: the one you opened, or another one you added
Project     a folder on that machine
Workspace   a working folder of the project: the project folder, or with Git, each worktree
Session     a Pi Coding Agent chat running inside a workspace
```

A typical flow: add a project, choose a workspace or git worktree, start a session, let the agent work, and come back later from any browser.

## Security

PI WEB has no user accounts and assumes trusted users, repositories and server paths; it is not a sandbox or a multi-user platform. Keep it on localhost, a private network, an SSH tunnel or an authenticated reverse proxy, never directly on the public internet; an optional [access token](docs/install.md#require-an-access-token) adds a second layer. See [SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.

## Documentation

- [Install](docs/install.md): requirements, install options, services, updates, remote access
- [Configuration](docs/config.md): config files, keys, environment variables, restart rules
- [Machines](docs/machines.md): use several PI WEB machines from one page
- [Remote-first development](docs/remote-first.md)
- [Plugins](docs/plugins.md): PI WEB plugins and Pi packages
- [FAQ and troubleshooting](docs/faq.md)

Plugins and packages maintained alongside PI WEB: [docs/plugins.md](docs/plugins.md#packages).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, checks and pull request expectations.

## License

MIT © 2026 Federico Jaramillo Martinez and the Gang of Beads contributors. See [LICENSE](LICENSE).
