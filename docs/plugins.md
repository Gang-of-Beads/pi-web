# PI WEB plugins

PI WEB plugins are trusted packages that add to the PI WEB page (actions, pages, labels, themes, transcript renderers, buttons on messages, composer controls) and, optionally, run a server half inside PI WEB on the same machine. This page is for people who install, enable and operate plugins.

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

**Settings → PI WEB Plugins** lists every plugin the selected machine discovered: bundled, local, project and Pi-package plugins, including those turned off and those only the running session daemon still knows. Each card shows the plugin's state (browser-only, active, failed, incompatible, disabled, not active, conflict, stale revision, restart required and others) and its diagnostics. Plugin settings values are never shown, only a fingerprint. A plugin whose pages run commands in the session on screen lists them on its card ("Runs session commands: /deploy-stop"): only those extension commands, and only in the session the page shows (see [Plugin API reference: running a session command](plugin-api.md#running-a-session-command)). A plugin you granted models ([`plugins.<id>.models`](config.md#models-a-plugin-may-call)) shows one line per model: its calls and tokens since the session daemon started, and the cost the provider reported.

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
- a changed `settings` object, private `serverSettings` block or `models` list of a plugin with a server half, and a new package revision of a running plugin, take effect at the next session-daemon start;
- a web route a plugin adds is mounted only when the web server starts, so a plugin that was off then answers its routes with `404` until the web server restarts;
- a machine running an older PI WEB applies a browser-half toggle when Settings closes, by reloading the page;
- a hand edit of the config file applies to a browser half at the next page load and to a server half at the next session-daemon start.

### What happens when a plugin is turned on or off

Each process that runs the plugin's server half applies the toggle before the save answers:

| Event | What the host does, in order |
|---|---|
| Turned on | Imports the server module, calls its `activate`, then its `start`. Its operations answer once `start` resolved, and so do the routes it contributed when the web server started. |
| Turned off | Its operations and routes stop accepting calls and answer `409` with `code: "plugin-not-active"`, and it hears no more [server facts](plugin-api.md#server-facts). Every call and fact listener still running is aborted, and the host waits for them to settle, up to the 10-second lifecycle timeout. Then `stop` runs once, bounded by the same timeout. |

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
| `goal` | The **Goals** page of a project and the global **All goals** page for [pi-goal](https://github.com/Gang-of-Beads/pi-goal), cards for its tools in the transcript, and the open goal on each session tile. Needs pi-goal 1.0.0 or later installed as a pi package. | browser and server |
| `git` | Claims Git projects as the fallback workspace provider, lists their worktrees and offers to remove them, and adds the **Git** status and diff page. | browser and server |
| `info` | An **Info** page with PI WEB and machine status, a workspace label, and **Copy PI WEB Diagnostics**. | browser |
| `machines` | The machine registry, the add-machine dialog and the machine actions (refresh, open, remove). | browser and server (web process) |
| `mermaid` | Draws `mermaid` code blocks in the transcript as diagrams; the source stays underneath. | browser |
| `terminal` | The **Terminal** page of a project, and the global **Terminal** page for the machine's own shells. | browser |
| `updates` | The global **Updates** page, **Check for PI WEB Updates**, and a pop-up offering each new PI WEB release and pi package version. | browser and server |
| `workspaces` | The project and workspace lists, **Add project**, and the workspace file routes the Files page reads through. | browser and server (web process) |

Turning off `workspaces` or `machines` removes core parts of the app (the project lists, the file routes, the machine registry); keep them on unless you replace them with a plugin that provides the same.

### Add project

**Add project** opens on the selected machine's home folder, and the dialog names that machine; every folder it lists and the project it adds stay on that machine. The path of the current folder is shown at the top: choose any part of it to go there, choose a subfolder to open it, or use **Up**. **Add project** adds the current folder. The pencil beside the path lets you type a path instead, with folder suggestions; Enter opens the typed folder.

The browser lists only folders, one level at a time, and reaches every folder PI WEB's account on that machine may read. A folder it cannot read, or one that does not answer in time, says so rather than looking empty, and a folder with more than 500 subfolders shows the first 500 and says how many there are. On Windows the path starts at the drive or the network share (`\\server\share`); type a path to change drive.

**New folder** names a folder to create inside the current one. Nothing is created until you choose **Add project**: cancelling the dialog leaves the disk unchanged. A typed path that does not exist is created the same way. The **Trust this project** choice applies to the folder you add; browsing folders trusts nothing.

### Goal

Goal is PI WEB's front end for [pi-goal](https://github.com/Gang-of-Beads/pi-goal), the Pi extension that turns a goal into confirmed TODOs the agent carries out. pi-goal is installed on its own (`pi install npm:@gang-of-beads/pi-goal`, 1.0.0 or later); Goal draws what pi-goal stores and asks pi-goal for every change. Go to leaves the pages out while the session on screen reports pi-goal not loaded (with no session, or before that is known, they stay listed), and pi-goal's own widget key is left out of Go to while Goal stands for it.

- **Goals**, a page of the project, lists the goals pi-goal stored for the folder of the session on screen (the project's folder when no session is open): open goals first, finished goals under **Finished**, each with its state, TODO progress, execution time and the next TODO. Opening a goal shows its TODOs, with the evidence or the blocker each one records. The page reads again every few seconds while it is shown, and after each turn.
- With a session of that folder on screen, the page acts through pi-goal's `/goal` command in that session, as typing it would: **Add goal** sends `/goal <text>` (pi-goal then asks its questions in the chat), **Run**, **Continue** or **Clarify** sends `/goal run #<id>`, **Pause** sends `/goal pause #<id>`, and **Status in chat** sends `/goal status #<id>`. pi-goal applies its own checks; the line under the field says what it answered. Without such a session the page is read-only, and so is a goal whose number another goal in the folder shares until pi-goal renumbers it. The plugin's card in **Settings → PI WEB Plugins** lists `/goal` as the command its page runs.
- **All goals**, a global page, lists every folder's goals on the machine on screen, read-only.
- A session tile in Navigate names the most pressing open goal the session created, with its progress.
- In the transcript, pi-goal's `goal_plan` calls show the question and its answer, or the proposed TODOs and approvals, and `goal_todo` calls show which TODO became what, with its evidence. The answers themselves are given in pi-goal's dialog cards (see [Pi extension dialogs](pi-extensions.md#pi-extension-dialogs-in-pi-web)).

Goal reads pi-goal's files under the agent directory (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`) and never writes them. A goal file pi-goal would skip is skipped here too and counted under the list; when nothing could be read the page says so rather than showing an empty folder.

### Git

Git is the only workspace provider bundled with PI WEB. An enabled third-party provider that is not a fallback can claim a project before Git does. With `git` off (after a session-daemon restart), each project is shown as a single folder workspace, and Files, Terminal and sessions keep working in it.

Which provider owns a project's workspaces:

1. Primary providers (those not marked fallback) are asked first. If exactly one claims the project, it owns it.
2. If none claims it, fallback providers such as Git are asked.
3. Two claimants in the same tier are a visible conflict; PI WEB does not pick one by id or load order.
4. If no provider claims the project, its folder is the one workspace. A provider that claimed the project and then fails to list it is reported as degraded; PI WEB does not silently hand the project to another provider.

### Updates

**Updates** is a global page about the machine on screen, listed in Go to. While a tab is connected, PI WEB refreshes the selected machine's status every 15 minutes, and that machine caches npm release lookups for six hours. **Check for PI WEB Updates** in the action palette bypasses both caches. Settings that skip remote version checks, such as `PI_WEB_OFFLINE`, are respected.

The **Pi packages** group, under Services, lists the pi packages installed for the machine's user (the active agent profile's user scope) by their short names and where each comes from (`npm`, or the git host and owner), each with its state: a newer version, up to date, being checked (a package added since the last check), pinned by its source (an exact npm version or a git ref; not checked), a local path (cannot be checked), not installed yet, or a failed check with the tool's own error. A newer version has its own **Update** button on its row, and **Update all**, beside the group's heading, updates every package with a newer version, one at a time; each row then shows its result. Updates run in the page, through the same route Settings → Pi Packages uses. Packages a project declares in `.pi/settings.json` are not checked here. Each machine checks its own packages with its own network and credentials (`npm view` through the profile's `npmCommand`, `git ls-remote` against the checkout's upstream), at most every six hours, and a package added since the last check at once; **Check now** checks again, and the heading says when the last check ran. When the machine cannot list its packages, the group says so with the reason. A package whose state this page cannot read, such as one from a newer PI WEB on the machine, keeps its row and says so.

After a package update:

- Running sessions keep the old version until you type `/reload` in them; new sessions use the new one.
- A package that brings a PI WEB server plugin needs a restart of the process that loads that plugin, then a tab reload: the session daemon, or the web server for a plugin declared `runs: "web"` or `"both"`. The page names the process for that package.
- A package that adds a model provider needs a session daemon restart. PI WEB cannot detect this, so the page always reminds you.

When a newer PI WEB release or pi package version is known, Updates opens one pop-up for that machine, titled **Updates on** and the machine's name, with a PI WEB group and a Pi packages group. Each line has its own **Update**, and the pop-up has **Update all**, which updates the packages first and hands over the PI WEB update only when every package updated. The PI WEB update is confirmed in the pop-up and then runs from the Updates page, in a terminal you can follow, because it restarts the web process and the session daemon. How you leave the pop-up is remembered by the plugin's server half, so an answer on one device settles it on the others:

- **Remind me in** 1 hour, 1 day or 1 week closes it until that delay has passed.
- **Don't remind me about these versions** settles the offered versions; a newer version is offered again.
- Closing it with its close key, Escape or a tap outside reminds you after 1 day.

The checkbox **Offer new versions in a pop-up**, the last row of the Pi packages group, turns the package lines of the pop-up off or on for the machine on screen; it is on by default. While the change is saved the checkbox shows a spinner; when the machine does not take it, the checkbox goes back and the row says **not saved**. With it off, the badge and the page still show package updates. Updates is machine-specific: while a remote machine is selected, that machine's own Updates plugin is used.

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
- A fleet page (a global page about every machine, such as a fleet-wide session list) comes from this server's own copy of its plugin. It is listed once in Go to whichever machine is selected, and lists each machine's sessions and reachability from what this page already reads. A remote machine's copy of a fleet page is ignored while this server has the plugin; a plugin installed only on remote machines brings its fleet page from the first of them whose plugins the page loaded. Plugin authors: see the [fleet](plugin-api.md#fleet) in the API reference.
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
| [pi-goal](https://github.com/Gang-of-Beads/pi-goal) | Goal mode for pi: clarify a goal with `/goal`, confirm its TODOs and let the agent carry them out | `npm:@gang-of-beads/pi-goal` |
| [pi-web-goals](https://github.com/Gang-of-Beads/pi-web-goals) | A Goals page for pi-goal: each goal's status and task progress | `npm:@gang-of-beads/pi-web-goals` |
| [pi-web-voice](https://github.com/Gang-of-Beads/pi-web-voice#readme) | A **Dictate** control in the composer, for a speech-to-text service you configure | `npm:@gang-of-beads/pi-web-voice` |
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
- **A plugin in the web server hears no session facts.** The web server relays [server facts](plugin-api.md#server-facts) from the session daemon. A session daemon older than the web server has no relay, and `pi-web logs` says, at info level, "the session daemon has no server facts route; the relay waits for it to restart onto a newer version", with the daemon's `runtimeVersion` and the reason (`daemon version` or `upgrade answered 404`); restart the session daemon. The web server checks again every few seconds and connects as soon as a newer session daemon answers; the plugin hears `facts.resumed` once the relay connects. A relay frame the web server cannot read, from a session daemon newer than it, is dropped and logged once per kind: "the server facts relay dropped a frame from the session daemon it cannot read"; restart the web server so it runs the same version as the session daemon.
- **The session daemon will not start because of a plugin.** Use [offline disable or safe start](#recover-from-a-broken-plugin).

To see what the browser is offered, open `pi-web-plugins/manifest.json` under the PI WEB address, for example `http://127.0.0.1:8504/pi-web-plugins/manifest.json`.
