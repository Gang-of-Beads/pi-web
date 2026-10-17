# PI WEB plugins

PI WEB plugins are trusted packages that add to the PI WEB page (actions, pages, labels, themes, transcript renderers, composer controls) and, optionally, run a server half inside PI WEB on the same machine. This page is for people who install, enable and operate plugins.

Writing a plugin? Read these instead:

- [Plugin authoring guide](plugin-authoring.md): build, test and publish a plugin, step by step.
- [Plugin API reference](plugin-api.md): every contribution, context member, limit and error.
- [Plugin conventions](plugin-conventions.md): the rules a published plugin follows.
- [Pi extensions under PI WEB](pi-extensions.md): how `ctx.ui`, custom renderers and interactive cards behave when a Pi extension runs under PI WEB.

## Pi packages, Pi extensions and PI WEB plugins

- **Pi packages** are distribution bundles managed by Pi (`pi install`, `pi remove`, `pi update`). A Pi package can carry Pi extensions, skills, prompt templates, themes, context files and PI WEB plugins. Many Pi packages carry no PI WEB plugin.
- **Pi extensions** are modules Pi loads into each session. They register tools, hooks, commands and model providers. They are not PI WEB plugins; see [Pi extensions under PI WEB](pi-extensions.md).
- **PI WEB plugins** are declared in a package's `package.json` under `piWeb.plugins`. Each entry has a browser module, a server module, or both. PI WEB discovers them from its own bundled plugins, from a local plugin directory, from trusted projects, and from installed Pi packages.

Installing a package and turning a plugin on are separate steps: Pi installs packages, and PI WEB decides which discovered plugins run.

## Install a plugin

Install the Pi package that carries it, on the machine that should run it:

- in **Settings → Pi Packages**, enter the package source, such as `npm:@scope/package`, a `git:` source or a local path; or
- in a terminal, run `pi install <source>`.

PI WEB installs into Pi's default package location, as `pi install <source>` does. When several machines are registered, **Settings → Pi Packages** acts on the machine selected in PI WEB and says which one that is.

After installing, removing or updating a package:

- a plugin with only a browser half appears after you reload the PI WEB tab;
- a plugin with a server half needs a restart of that machine's session daemon, then a reload of the tab;
- the package's other Pi resources (extensions, skills, prompt templates) reach a running session after you type `/reload` in it. A Pi extension that registers a model provider follows its own rule; see [Pi extension provider baseline](config.md#pi-extension-provider-baseline).

To try a plugin from a folder without packaging it, link it into PI WEB's local plugin directory (`$PI_WEB_DATA_DIR/plugins`, `~/.pi-web/plugins` by default). The link name is the plugin package's directory name and must match `^[a-z][a-z0-9.-]*$`:

```bash
mkdir -p ~/.pi-web/plugins
ln -s /path/to/plugin-folder ~/.pi-web/plugins/my-plugin
```

## Turn plugins on and off

**Settings → PI WEB Plugins** lists every plugin the selected machine discovered: bundled, local, project and Pi-package plugins, including those turned off and those only the running session daemon still knows. Each card shows the plugin's state (browser-only, active, failed, incompatible, disabled, not active, conflict, stale revision, restart required and others) and its diagnostics. Plugin settings values are never shown, only a fingerprint.

Plugins are on by default. The toggle writes the selected machine's `plugins` key in the global PI WEB config ([config reference](config.md#pi-web-plugin-config-and-recovery)):

```json
{
  "plugins": {
    "git": { "enabled": true, "settings": {} },
    "info": { "enabled": false }
  }
}
```

A toggle saved in Settings applies at once, without a restart or reload, with these exceptions:

- a plugin that supplies a workspace provider (such as Git) or the machine registry (Machines) takes effect at the next session-daemon start; its card says **Restart required** until then;
- a changed `settings` object or private `serverSettings` block of a plugin with a server half, and a new package revision of a running plugin, take effect at the next session-daemon start;
- a web route a plugin adds is mounted only when the web server starts, so a plugin that was off then answers its routes with `404` until the web server restarts;
- a machine running an older PI WEB applies a browser-half toggle when Settings closes, by reloading the page;
- a hand edit of the config file applies to a browser half at the next page load and to a server half at the next session-daemon start.

### What happens when a plugin is turned on or off

Each process that runs the plugin's server half applies the toggle before the save answers:

| Event | What the host does, in order |
|---|---|
| Turned on | Imports the server module, calls its `activate`, then its `start`. Its operations answer once `start` resolved, and so do the routes it contributed when the web server started. |
| Turned off | Its operations and routes stop accepting calls and answer `409` with `code: "plugin-not-active"`. Every call still running is aborted, and the host waits for those calls to settle, up to the 10-second lifecycle timeout. Then `stop` runs once, bounded by the same timeout. |

The machine then announces the change to every page browsing it, and each page applies it without reloading:

| Event | What each page does, in order |
|---|---|
| Turned on | Reads the machine's plugin manifest again, imports each browser module it now lists and has not loaded, and activates it. Its contributions appear at once. |
| Turned off | Reads the manifest again, drops each browser module the manifest no longer lists, calls its `dispose`, and removes its contributions. |

A page that missed the announcement (offline, or its connection dropped) reads the manifest again when it reconnects. A browser module that fails to load leaves nothing of the plugin on the page, and its card says "Did not load in this browser" with the reason. The guarantees a plugin can build on are in [Plugin API reference: lifecycle](plugin-api.md#lifecycle-guarantees).

### Desired and active state

The session daemon decides which server halves run when it starts, and is the authority on workspaces for its whole lifetime. Anything a live toggle does not cover (the exceptions above, replaced package files) changes the **desired** state only. Until the daemon restarts, the old server half may keep running, and its browser half is withheld from the page while its revision no longer matches the desired one. Restarting the web server or reloading the page does not change what the daemon runs.

To apply such a change:

1. Install or update the package on the target machine.
2. Set the plugin's enablement and settings.
3. Restart that machine's session daemon and wait for it to come back. For the systemd user service: `systemctl --user restart pi-web-sessiond`. Other service managers are covered in the [installation guide](install.md).
4. Reload the PI WEB tab.

Restarting the session daemon may interrupt running sessions. Look at active work first.

## Built-in plugins

PI WEB ships these plugins in its npm package; no `pi install` is needed. Each can be turned off in **Settings → PI WEB Plugins** or with `plugins.<id>.enabled: false`. After updating PI WEB, restart the session daemon so bundled server halves run the installed revision, then reload the tab.

| Id | What it adds | Halves |
|---|---|---|
| `files` | The **Files** page of a project: browse and view workspace files, and upload files. | browser |
| `git` | Claims Git projects as the fallback workspace provider, lists their worktrees and offers to remove them, and adds the **Git** status and diff page. | browser and server |
| `info` | An **Info** page with PI WEB and machine status, a workspace label, and **Copy PI WEB Diagnostics**. | browser |
| `machines` | The machine registry, the add-machine dialog and the machine actions (refresh, open, remove). | browser and server (web process) |
| `mermaid` | Draws `mermaid` code blocks in the transcript as diagrams; the source stays underneath. | browser |
| `terminal` | The **Terminal** page of a project, and the global **Terminal** page for the machine's own shells. | browser |
| `updates` | The global **Updates** page, **Check for PI WEB Updates**, and a one-time offer of each new PI WEB release. | browser and server |
| `voice` | A **Dictate** control in the composer, once speech-to-text is configured. | browser and server |
| `workspaces` | The project and workspace lists, **Add project**, and the workspace file routes the Files page reads through. | browser and server (web process) |
| `workspace-tasks` | A **Tasks** page that runs commands from the project's `.pi-web/tasks.json` in dedicated terminals. | browser |

Turning off `workspaces` or `machines` removes core parts of the app (the project lists, the file routes, the machine registry); keep them on unless you replace them with a plugin that provides the same.

### Add project

**Add project** opens on the selected machine's home folder, and the dialog names that machine; every folder it lists and the project it adds stay on that machine. The path of the current folder is shown at the top: choose any part of it to go there, choose a subfolder to open it, or use **Up**. **Add project** adds the current folder. The pencil beside the path lets you type a path instead, with folder suggestions; Enter opens the typed folder.

The browser lists only folders, one level at a time, and reaches every folder PI WEB's account on that machine may read. A folder it cannot read, or one that does not answer in time, says so rather than looking empty, and a folder with more than 500 subfolders shows the first 500 and says how many there are. On Windows the path starts at the drive or the network share (`\\server\share`); type a path to change drive.

**New folder** names a folder to create inside the current one. Nothing is created until you choose **Add project**: cancelling the dialog leaves the disk unchanged. A typed path that does not exist is created the same way. The **Trust this project** choice applies to the folder you add; browsing folders trusts nothing.

### Git

Git is the only workspace provider bundled with PI WEB. An enabled third-party provider that is not a fallback can claim a project before Git does. With `git` off (after a session-daemon restart), each project is shown as a single folder workspace, and Files, Terminal and sessions keep working in it.

Which provider owns a project's workspaces:

1. Primary providers (those not marked fallback) are asked first. If exactly one claims the project, it owns it.
2. If none claims it, fallback providers such as Git are asked.
3. Two claimants in the same tier are a visible conflict; PI WEB does not pick one by id or load order.
4. If no provider claims the project, its folder is the one workspace. A provider that claimed the project and then fails to list it is reported as degraded; PI WEB does not silently hand the project to another provider.

### Updates

**Updates** is a global page about the machine on screen, listed in Go to. While a tab is connected, PI WEB refreshes the selected machine's status every 15 minutes, and that machine caches npm release lookups for six hours. **Check for PI WEB Updates** in the action palette bypasses both caches. Settings that skip remote version checks, such as `PI_WEB_OFFLINE`, are respected.

When a newer release is known, Updates offers it once per version per machine; the answer is kept by the plugin's server half, so dismissing the offer on one device settles it on the others. Updates is machine-specific: while a remote machine is selected, that machine's own Updates plugin is used.

### Voice

Dictation is offered only after the plugin's settings name a speech-to-text service (`plugins.voice.settings`, with at least an `endpoint`). Without them the composer shows no microphone control.

For Azure Speech, name the service in `settings` and put the key in `serverSettings`, which no browser receives ([private plugin settings](config.md#private-plugin-settings)):

```json
{
  "plugins": {
    "voice": {
      "settings": {
        "endpoint": "https://westeurope.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
        "language": "en-US",
        "streaming": {
          "protocol": "azure-speech",
          "url": "wss://westeurope.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
        },
        "azureSpeech": { "region": "westeurope", "resource": "example-speech" }
      },
      "serverSettings": {
        "azureSpeech": { "key": "replace-with-your-key" }
      }
    }
  }
}
```

- **The key stays on the machine.** Voice's server half runs in the session daemon, keeps the key, and gives the page a token that expires after ten minutes. Both ways of dictating use it: live dictation opens its socket with it, and a recorded clip is uploaded with `Authorization: Bearer <token>`. If no token can be had, for example because no key is configured, the composer says why and sends nothing.
- **`resource`** is the resource's custom subdomain; tokens are requested from it, or from the region's endpoint when it is absent.
- **`streaming`** makes dictation live: words appear while you speak. Only `azure-speech` streams in this version. A `streaming` block that cannot stream, because it has no `url` or names `browser`, `openai-realtime` or `deepgram`, shows the reason instead of recording a clip. Without a `streaming` block, the clip is recorded and uploaded to `endpoint` when you stop. `streaming.tokenEndpoint` is no longer needed and is ignored.
- **Other services.** An `endpoint` with no `azureSpeech` block, such as a Whisper-compatible service on the same host, receives the recorded clip as configured, without a credential.
- **Sessions.** A dictation and its status line belong to the session you started it in; other sessions' composers do not show them. Switching to another session or machine stops the dictation and releases the microphone, and text that arrives afterwards goes into the draft of the session it was started in. A new session finishing its start while you dictate is not a switch: the dictation goes on in it.

Versions before this one read the key from `settings.azureSpeech.key`. A key there still works, but every browser that opens PI WEB can read it, and the plugin's card in **Settings → PI WEB Plugins** shows **Health degraded** with where to move it. To move it:

1. Add `"serverSettings": { "azureSpeech": { "key": "…" } }` to the `voice` entry, by editing the config file or with a `serverSettingsUpdates` write ([private plugin settings](config.md#private-plugin-settings)).
2. Remove `key` from `settings.azureSpeech`.
3. Restart the session daemon, then reload the tab.

The old key has been readable by browsers; rotate it in Azure if that matters for your deployment.

### Workspace Tasks

Configure tasks in `.pi-web/tasks.json` in the project:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "app.start",
      "title": "Start app",
      "group": "Development",
      "description": "Start the local development server.",
      "command": "npm run dev"
    },
    {
      "id": "db.reset",
      "title": "Reset DB",
      "group": "Database",
      "command": "npm run db:reset",
      "confirm": true
    }
  ]
}
```

Open a project, choose the **Tasks** page, and choose **Run** beside a task. The command runs in the workspace root, in a terminal PI WEB creates for that workspace.

| Field | Meaning |
|---|---|
| `version` | Must be `1`. |
| `tasks` | The task definitions. |
| `id` | Stable task id, matching `^[a-z][a-z0-9.-]*$`. |
| `title` | The button label. |
| `command` | The shell command typed into the terminal, as written. |
| `description` | Optional explanatory text. |
| `group` | Optional group heading. |
| `confirm` | Optional; when `true`, PI WEB asks before running the command. |

Tasks are shell commands from the repository. Review `.pi-web/tasks.json` before running tasks in a project you did not write.

## Project-local plugins

A trusted project can carry its own plugins in `<project>/.pi-web/plugins/<plugin-package>/`, laid out like the local plugin directory. PI WEB reads that directory only for projects you have trusted (the same project trust Pi uses for project-local extensions; see [Project trust](config.md#project-trust-for-project-local-resources)). In a project that is not trusted, the plugins are not loaded and **Settings → PI WEB Plugins** reports `withheld-untrusted`: "Plugins in … are not loaded because this project is not trusted."

Today only the server half of a project-local plugin runs, in the session daemon. Its browser half is not offered to the page.

## Where PI WEB finds plugins

PI WEB looks in these places, in this order. The first package that declares a plugin id wins; a later package with the same id is skipped and reported as `duplicate-id`.

1. Bundled plugins, in the installed PI WEB package (`dist/pi-web-plugins/`).
2. In a source checkout of PI WEB only, the checkout's `plugins/` directory.
3. The local plugin directory, `$PI_WEB_DATA_DIR/plugins` (`~/.pi-web/plugins` by default). Entries may be directories or symlinks.
4. The `.pi-web/plugins/` directory of each trusted project.
5. Installed Pi packages, user and project scope.

The bundled-first order is why a release of PI WEB that still bundles a plugin keeps using its own copy when you also install that plugin from npm.

## Plugins on remote machines

When [machines](machines.md) are registered, the page loads the selected remote machine's browser plugins through this server, and their server halves run on that remote machine. A plugin's actions, pages and labels appear only while their machine is selected, and its file, terminal and backend calls go to that machine.

- Plugin enablement is stored per machine. Select the machine in **Settings → PI WEB Plugins** to change it there.
- If this server and the remote machine both have a plugin with the same id, a plugin that is not machine-specific uses this server's copy for every machine; a machine-specific plugin uses each machine's own copy.
- Themes from remote machines are ignored, because the theme applies to the whole app.
- Plugin compatibility is all-or-nothing across versions: a newer gateway refuses the whole plugin manifest of a remote machine that lacks the current plugin lifecycle contract, and an older gateway cannot reach Git status and diff on an updated machine. Update both, restart their web servers and the remote session daemon, then reload the tab.

## Recover from a broken plugin

These commands edit the global PI WEB config without contacting the session daemon, discovering packages or importing plugin code. Run them on the affected machine; add `--config /path/to/config.json` when its services use a non-default `PI_WEB_CONFIG`.

```bash
pi-web plugins disable <plugin-id> --restart
pi-web plugins safe-start show
pi-web plugins safe-start set bundled-only --restart
pi-web plugins safe-start set none --restart
pi-web plugins safe-start clear --restart
```

- `disable` sets `plugins.<id>.enabled` to `false` and keeps the rest of the config.
- `bundled-only` starts only bundled server halves; local, project and Pi-package server halves stay off.
- `none` starts no server halves at all; each project is shown as its folder workspace.
- `clear` returns the next start to ordinary discovery.
- `--restart` restarts the session daemon when PI WEB recognizes the installed service; otherwise the command prints what to run. The config is written before the restart is attempted.

A `serverPlugins.safeStart` value PI WEB does not understand is treated as `none` and reported; repair it with `safe-start show`, then `set` or `clear`. Safe start exists for a plugin that blocks or crashes the session daemon before PI WEB can contain it. Any restart may interrupt running sessions.

## Trust model

A plugin is trusted code with your permissions. Install plugins only from sources you trust.

- A browser half runs in the PI WEB page. It can read and write workspace files, run commands in terminals, and draw anything on the page.
- A server half runs inside the session daemon (or the web server) with the PI WEB service user's files, environment and processes, and shares its event loop. A plugin that blocks or loops can stall sessions, terminals and health checks.
- PI WEB attributes and isolates ordinary plugin failures (a failed import, activation, start or stop), but that is a stability boundary, not a security boundary.
- Project-local plugins load only from trusted projects.

## Packages

These Pi packages are maintained alongside PI WEB. Install one from **Settings → Pi Packages** with its source, or with `pi install <source>`. The installer's [Gang of Beads preset](install.md#gang-of-beads-preset) adds most of them in one step.

| Package | What it adds | Source |
|---|---|---|
| [pi-web-themes](https://github.com/Gang-of-Beads/pi-web-themes) | More PI WEB themes: PI WEB, Clay and Pro light/dark pairs, plus Classic, Night, Paper and High Contrast | `npm:@gang-of-beads/pi-web-themes` |
| [pi-web-workflows](https://github.com/Gang-of-Beads/pi-web-workflows) | Draws the pi-dynamic-workflows `workflow` tool as a live progress card | `npm:@gang-of-beads/pi-web-workflows` |
| [pi-web-background-runs](https://github.com/Gang-of-Beads/pi-web-background-runs) | A Background page and running count for pi-background-tasks (`bg_run`) tasks | `npm:@gang-of-beads/pi-web-background-runs` |
| [pi-subagents](https://github.com/Gang-of-Beads/pi-subagents) | Subagents for pi: hand work to child agents, one at a time, in parallel or as scripted workflows | `npm:@gang-of-beads/pi-subagents` |
| [pi-web-subagents](https://github.com/Gang-of-Beads/pi-web-subagents) | A Subagents page for pi-subagents runs, and a card to answer a child's question | `npm:@gang-of-beads/pi-web-subagents` |
| [pi-goal](https://github.com/Gang-of-Beads/pi-goal) | Goal mode for pi: long-running objectives with tasks, auto-continue and a completion audit | `npm:@gang-of-beads/pi-goal` |
| [pi-web-goals](https://github.com/Gang-of-Beads/pi-web-goals) | A Goals page for pi-goal: each goal's status and task progress | `npm:@gang-of-beads/pi-web-goals` |
| [pi-ask-user](https://github.com/Gang-of-Beads/pi-ask-user) | An `ask_user` tool the agent uses to ask you a question; PI WEB draws it as a card | `npm:@gang-of-beads/pi-ask-user` |
| [pi-multi-account](https://github.com/Gang-of-Beads/pi-multi-account) | Several OAuth accounts per provider, and Claude subscription billing | `npm:@gang-of-beads/pi-multi-account` |
| [pi-updater](https://github.com/Gang-of-Beads/pi-updater) | Offers updates for pi; under PI WEB it names the session-daemon restart an update needs | `npm:@gang-of-beads/pi-updater` |
| [pi-bash-autobg](https://github.com/Gang-of-Beads/pi-bash-autobg) | Moves a long-running bash call to the background instead of blocking the agent | `git:github.com/Gang-of-Beads/pi-bash-autobg` |

To propose another package for this table, open a pull request that adds its row; the criteria are in [Plugin conventions: listing](plugin-conventions.md#listing-a-package).

## Troubleshooting

- **A plugin does not appear.** Check **Settings → PI WEB Plugins** on the selected machine for its card and diagnostics. A plugin that is not listed was not discovered: the package is not installed through Pi or linked into `$PI_WEB_DATA_DIR/plugins`, or its `package.json` was rejected (the card or `pi-web logs` says why).
- **"Did not load in this browser".** The browser module failed to import or activate; the card gives the reason and the browser console has the details.
- **Failed, incompatible, unhealthy or conflict.** The server half failed in the phase the card names; `pi-web logs` on that machine has the error.
- **A plugin with a server half shows no pages.** Its browser half is withheld while the session daemon is unavailable or runs a different revision or settings than desired. Restart the session daemon, then reload the tab.
- **`duplicate-id`.** Two packages declare the same plugin id; the first one found wins (see [Where PI WEB finds plugins](#where-pi-web-finds-plugins)). Remove one of them.
- **`withheld-untrusted`.** A project-local plugin in a project you have not trusted. Trust the project, or remove its `.pi-web/plugins/` directory.
- **A remote machine's plugins are missing.** That machine lacks the plugin lifecycle contract this gateway needs; update and restart PI WEB there.
- **The session daemon will not start because of a plugin.** Use [offline disable or safe start](#recover-from-a-broken-plugin).

To see what the browser is offered, open `pi-web-plugins/manifest.json` under the PI WEB address, for example `http://127.0.0.1:8504/pi-web-plugins/manifest.json`.
