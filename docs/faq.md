# FAQ and troubleshooting

Most PI WEB install problems come from the environment: the service manager, `PATH` setup, Node.js version managers, or remote-access expectations.

- [What platforms are supported?](#what-platforms-are-supported)
- [Is PI WEB a Pi web UI?](#is-pi-web-a-pi-web-ui)
- [Which of pi's slash commands work in PI WEB?](#which-of-pis-slash-commands-work-in-pi-web)
- [Tools are failing, node is not found, or Pi cannot find commands](#tools-are-failing-node-is-not-found-or-pi-cannot-find-commands)
- [What does `pi-web doctor` check?](#what-does-pi-web-doctor-check)
- [I installed Node with nvm, fnm, asdf, or another version manager](#i-installed-node-with-nvm-fnm-asdf-or-another-version-manager)
- [`pi-web-sessiond` cannot load `pty.node`](#pi-web-sessiond-cannot-load-ptynode)
- [User service manager is unavailable](#user-service-manager-is-unavailable)
- [I cannot open the web UI](#i-cannot-open-the-web-ui)
- [Can I expose PI WEB to the public internet?](#can-i-expose-pi-web-to-the-public-internet)
- [How do I connect another PI WEB machine?](#how-do-i-connect-another-pi-web-machine)
- [Subscription login on a remote machine ends on a page that will not load](#subscription-login-on-a-remote-machine-ends-on-a-page-that-will-not-load)
- [Should I run PI WEB on my laptop or a server?](#should-i-run-pi-web-on-my-laptop-or-a-server)
- [Can I use local plugins with an installed PI WEB?](#can-i-use-local-plugins-with-an-installed-pi-web)
- [A worktree I created or deleted outside PI WEB is missing or still listed](#a-worktree-i-created-or-deleted-outside-pi-web-is-missing-or-still-listed)
- [Sessions stop unexpectedly](#sessions-stop-unexpectedly)
- [The session daemon exits at startup saying the state is owned](#the-session-daemon-exits-at-startup-saying-the-state-is-owned)
- [What do the marks on session rows mean?](#what-do-the-marks-on-session-rows-mean)
- [Model responses fail with "terminated" after about 5 minutes](#model-responses-fail-with-terminated-after-about-5-minutes)
- [Where are the logs?](#where-are-the-logs)

## What platforms are supported?

PI WEB runs wherever its runtime dependencies work. `pi-web install` needs a per-user service manager: systemd on Linux, launchd on macOS, termux-services on Termux, or Task Scheduler on Windows.

- **Linux and macOS:** `npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty`, then `pi-web install`.
- **Termux on Android:** see [Termux (Android)](install.md#termux-android).
- **Windows 10 or 11:** see [Windows](install.md#windows).
- **WSL:** if your distribution has systemd enabled, the installer can work; otherwise use the [manual run](install.md#wsl-or-manual-run).

## Is PI WEB a Pi web UI?

Yes. PI WEB is a web UI for Pi Coding Agent that runs and supervises persistent sessions from a browser. It is built around server-side workspaces, a long-running session daemon, git worktrees, remote machines, terminals, files, and supervision from several devices.

## Which of pi's slash commands work in PI WEB?

Type them in the composer, as in pi's terminal. The `/` menu lists every built-in that works, with pi's description. A slash command sent with an attachment is an ordinary message.

These open or act on PI WEB's own controls for the open session, at once, even while the agent is working; they are never sent to the session:

| Command | What happens |
| --- | --- |
| `/login [provider]`, `/logout` | The sign-in dialogs, for the selected machine |
| `/settings` | Settings |
| `/hotkeys` | Settings, on the Shortcuts page |
| `/model [provider/model or search]` | The model picker. An exact `provider/model`, or a search that matches one model, selects it without the picker; otherwise the picker opens with the search filled in |
| `/scoped-models` | The model picker on All models, where you choose the models the session can switch between |
| `/thinking [level]` | The thinking-level picker; a level the model offers is set without it |
| `/resume` | Navigation, on the session list |
| `/copy` | Copies the text of the last reply to the clipboard. A copy that works shows nothing; a failure shows for three seconds, in that session only |

These run in the session daemon and answer in the command's row in the transcript:

| Command | What happens |
| --- | --- |
| `/new`, `/name`, `/session`, `/compact`, `/reload`, `/fork`, `/clone`, `/tree` | As in pi |
| `/export [path]` | Writes the session as HTML, or as JSONL when the path ends in `.jsonl`. A relative path is relative to the session's folder; without a path, pi's default file name in that folder. The row names the file written |
| `/changelog` | The newest three versions of pi's changelog, from the pi version PI WEB runs, each folded under its version heading |
| `/trust` | Asks whether to trust the project and saves the decision as pi's `/trust` does; it applies to sessions started afterwards |

`/share`, `/import`, `/bug` and `/quit` are not available in PI WEB; typed, the command's row says so and nothing is sent to the model. Skills, prompt templates and extension commands go to the session as in pi. An extension command runs at once, even while a reply streams, as in pi's terminal: its row reads Running until the command's handler returns, and what the handler says appears in the chat. Skills and prompt templates are text for the model; typed while a reply streams, their row reads Queued until the reply finishes.

## Tools are failing, node is not found, or Pi cannot find commands

PI WEB services run commands through a non-interactive login shell started by systemd or launchd. An interactive terminal can find a tool that the service cannot. Run the diagnostics:

```bash
pi-web doctor
```

Then make sure your login shell sets up `PATH`:

- **bash:** put `PATH` setup in `~/.bash_profile` or `~/.profile`. If `~/.bash_profile` exists, source `~/.profile` from it if needed.
- **zsh:** put `PATH` setup in `~/.zprofile`, not only `~/.zshrc`.
- **fish:** prefer universal `PATH` setup, for example `fish_add_path -U ...`.

Do not rely on prompt hooks, shell integrations that rewrite `PATH` while drawing the prompt, or interactive-only shell files for tools the services need. Version-manager shims are usually the most reliable option.

If you installed with the Home Manager module, the services do not use a login shell at all; see [Nix and Home Manager](install.md#home-manager-module).

## What does `pi-web doctor` check?

It keeps two kinds of checks apart. General login-shell readiness covers Node.js 22.19.0 or newer, npm, Pi, and optional ripgrep. Service diagnostics check the exact requirements of the selected service plan inside the real systemd user manager or launchd `gui/<uid>` context. Development installs are checked against their installed checkout plan; production checks are labelled prospective when the installed executable cannot be reconstructed safely.

A missing plan requirement fails doctor with login-file guidance. Manager, timeout, malformed-output and cleanup failures are reported as probe problems rather than as `PATH` drift. Where only a manual run is possible, service checks are skipped. Doctor also checks that the `node-pty` native module loads, prints the installed and running PI WEB versions, and reports systemd lingering when relevant.

## I installed Node with nvm, fnm, asdf, or another version manager

Version managers often initialize only in interactive shells. Some, including `fnm` and `mise` when used through shell activation instead of shims, depend on shell hooks or prompt-time `PATH` updates that do not run in a non-interactive login shell.

- Prefer version-manager shims; for `mise`, use its shims rather than only shell activation.
- Move the version manager's initialization to your login shell file.
- Check that `node --version` is at least `v22.19.0` from `bash -lc`, `zsh -lc`, or your shell.
- Run `pi-web doctor` again after changing shell files.

## `pi-web-sessiond` cannot load `pty.node`

npm 12 blocks dependency install scripts unless they are approved. If PI WEB was installed without approving `node-pty`, its native module can be missing although npm reported success. Reinstall with approval limited to `node-pty`:

```bash
npm install -g @gang-of-beads/pi-web --allow-scripts=node-pty
```

Then run `pi-web install` again, or restart `pi-web-sessiond` if you run PI WEB manually. The flag does not enable install scripts for other dependencies.

## User service manager is unavailable

`pi-web install` needs systemd or launchd. On WSL without systemd, in a container without a user service manager, or in another minimal environment, run the two processes yourself:

```bash
pi-web-sessiond
# in another terminal
PI_WEB_PORT=8504 pi-web-server
```

## I cannot open the web UI

- Check `pi-web status`.
- Check the logs with `pi-web logs`.
- Make sure port `8504` is not already in use.
- On a remote server, publish it on your tailnet with Tailscale Serve, or use an SSH tunnel: `ssh -L 8504:127.0.0.1:8504 user@server`. See [Remote access](install.md#remote-access).
- With Tailscale Serve, keep PI WEB on `127.0.0.1`: binding `0.0.0.0` or the tailnet address on the served port fails with `EADDRINUSE`.

## Can I expose PI WEB to the public internet?

No. PI WEB has no login of its own and assumes trusted users and trusted server paths. Keep it on localhost and publish it to your tailnet with [Tailscale Serve](install.md#remote-access), or bind it only to an interface that is already private and controlled: the server's VPN address, a private LAN address, or localhost behind an SSH tunnel.

When you connect over a VPN, `127.0.0.1` means your own device, not the server, so the server must listen on its VPN or private address or sit behind a tunnel or proxy. Avoid `0.0.0.0` unless a firewall, VPN or reverse proxy strictly limits who can reach the port. See [SECURITY.md](../SECURITY.md) for the threat model.

## How do I connect another PI WEB machine?

Install and run PI WEB on the other machine, then choose **Add machine** on the Navigate page or in **Settings → Machines**, and enter its URL.

- **This browser** (the default): your browser talks to the machine directly. The machine shows a pairing code and an approval page; approve this page there once.
- **This server**: the PI WEB you opened forwards the traffic. Use it when the machine is reachable from that server but not from your browser, when it needs a token or headers, or when it runs an older PI WEB.
- Pi auth, sessions, terminals, repositories and plugin settings stay on the machine itself.
- If a machine shows as Offline, check that its web/API server and session daemon are running and reachable from your browser (for **This browser**) or from the server (for **This server**). An open Machines list checks again by itself.

[Machines](machines.md) covers the details.

## Subscription login on a remote machine ends on a page that will not load

That is expected. The provider flow runs on the remote machine, so its redirect address (`http://localhost:<port>/…`) points at that machine, not at the device you are browsing from. Approve the login, copy the full URL from your browser's address bar, and paste it into the login dialog, which asks for it whenever a pasted response is expected.

- When the provider offers a device-code option, choose it; it needs no paste.
- A flow that offers neither a pasted response nor a device code has to be completed on the machine itself: cancel, then run **Open selected machine PI WEB** from the action palette.

See [Credentials stay on each machine](machines.md#credentials-stay-on-each-machine).

## Should I run PI WEB on my laptop or a server?

Either works, but PI WEB is most useful on a machine that stays on. A remote dev box, home server, cloud VM or workstation gives agents a stable place to keep working while your laptop is just a client. See [Remote-first development](remote-first.md).

## Can I use local plugins with an installed PI WEB?

Yes. Put trusted plugin packages in `~/.pi-web/plugins/<plugin-id>/`, or symlink a development folder there (`$PI_WEB_DATA_DIR/plugins` when `PI_WEB_DATA_DIR` is set). A browser-only change needs a tab reload. A change to a plugin's server entry needs a [session daemon restart](install.md#restart-the-session-daemon) and then a reload; the restart can interrupt active sessions. See [Plugins](plugins.md).

## A worktree I created or deleted outside PI WEB is missing or still listed

PI WEB does not register worktrees. It lists the selected project's git worktrees on demand, so worktrees you create or delete with `git worktree`, a terminal or another tool appear without any import step, on remote machines too.

The workspace list is read again when the PI WEB tab regains focus or becomes visible, not continuously. If a worktree appeared while you were looking at PI WEB, switch to another window or tab and back. Your selected workspace, session and scroll position are kept.

Worktrees whose directory no longer exists are hidden, so a directory removed with `rm -rf` instead of `git worktree remove` stops appearing. Git still tracks it until you run `git worktree prune`.

## Sessions stop unexpectedly

The session daemon owns active agent runs. Browser disconnects and web/API restarts do not stop them. If they stop anyway, check whether the session daemon restarted or crashed:

```bash
pi-web status
pi-web logs
```

## The session daemon exits at startup saying the state is owned

Another session daemon is already running against the same data directory (`PI_WEB_DATA_DIR`, default `~/.pi-web`). The daemon claims that state at startup, and a second daemon exits with an error instead of corrupting it.

Stop the other instance, or start this one with its own `PI_WEB_DATA_DIR`, `PI_WEB_SESSIOND_SOCKET` (or `PI_WEB_SESSIOND_PORT` / `PI_WEB_SESSIOND_HOST`) and `PI_WEB_PORT`. See [Run a second instance](install.md#run-a-second-instance).

## What do the marks on session rows mean?

Each session row shows at most one status mark. When several are true at once, for example a session that asks a question and also has a turn you have not read, the higher one in this table wins.

| Mark | Color | Meaning |
| --- | --- | --- |
| Dot | Amber | The session is waiting for your answer. |
| Three pulsing dots | Blue | The session is working, or a message you sent is still being delivered. |
| Dot | Purple | The last turn finished and you have not opened it yet. |
| Dot | Red | The session hit an error. |
| Hollow ring | Purple | Your turn ended, but background work this session started is still running. |
| Dot | Gray | The session is done; nothing is in flight. |

Unread sessions also show their name in bold, and the Sessions heading counts them, so a finished turn stays visible even when a higher mark covers the dot.

## Model responses fail with "terminated" after about 5 minutes

A transcript row reading *The model provider had a temporary error*, whose details show `terminated` at about the five-minute mark, means a model stream stayed idle longer than Pi's HTTP idle timeout, the `httpIdleTimeoutMs` agent setting (five minutes by default). Slow backends, such as a local vLLM server that sends one large final chunk, can exceed it.

Raise or disable the timeout in the agent's `settings.json` (`~/.pi/agent/settings.json` by default); the [Pi settings reference](https://pi.dev/docs/latest/settings) lists the accepted values.

```json
{
  "httpIdleTimeoutMs": 0
}
```

The session daemon applies the value when it starts, so [restart the session daemon](install.md#restart-the-session-daemon) afterwards.

## Where are the logs?

| Install | Where |
| --- | --- |
| `pi-web install` on Linux | The journal: `pi-web logs`, or `journalctl --user -u pi-web-sessiond -u pi-web` |
| `pi-web install` on macOS | `~/.pi-web/logs/sessiond.log` and `web.log`: `pi-web logs` follows them |
| Manual run | Each process's own output |
| Docker | The Docker control command's `logs`; see [docker/README.md](../docker/README.md) |

How much the logs record and keep is set by [`logging`](config.md#logs).
