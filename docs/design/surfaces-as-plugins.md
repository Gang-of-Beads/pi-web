# Surfaces as plugins, and one official plugin pack

The owner's direction, recorded 2026-09-09:

1. The phone's collapsed quick-access page could also be a desktop tab.
2. The desktop right-hand panels should all be extensions.
3. The official plugins should ship as one installable project,
   `pi-web-official-plugins`.
4. The plugin design should support declarative contributions.

This page is the design and the choices behind it. Nothing here is implemented.

## Where we actually are

Read from the working tree, not from memory:

- Panels are already contributions. `pi-web-plugins/` holds files, git,
  terminal, relays, tasks, goals, workspaces, machines, updates and voice; the
  browser side registers surfaces through `src/client/src/plugins/registry.ts`
  and the host UI seam in `plugins/pluginHostUi.ts`.
- The seam is **imperative**: a plugin exports `activate(context)` and returns
  contributions built with `html` at runtime. Everything a plugin can do is a
  function call, which is why each new capability has needed a new host method
  (`renderDisclosureIcon`, `renderCloseIcon`, `showDialog`, `registerModal`).
- Bundled plugins are built by `scripts/build-plugins.mjs` into
  `dist/pi-web-plugins/<id>/` and discovered from the data directory. There is
  no packaging boundary that a third party installs in one step.
- The phone's quick access and the desktop tab strip are two different
  renderers over the same contribution list
  (`AppNavigationPanel` vs the panel tabs in `WorkspacePanel`).

So (1) and (2) are mostly a question of *which renderer* a contribution gets,
not of moving code between processes.

## The owner's answers (2026-09-09)

1. **Two lists.** A contribution says where it appears; the phone quick-access
   page and the desktop tab strip are separate declarations. No surprises from
   a shell that decides for you.
2. **Declarative to the data and UI layer**, with a clean public interface: a
   plugin declares its surfaces, the data it needs and the operations it
   offers, not just its metadata.
3. **A new repository, installed from GitHub**, not published to npm yet. The
   declaration format must accept an npm package, a GitHub repository, or any
   file layout that satisfies the format. Which format fits us best is a
   research question, answered below.
4. **Core keeps**: the agent capability itself, session management, the network
   layer, a minimal UI, and the extension machinery. Everything else is a
   plugin. The exact list is to be walked one item at a time with the owner.

## The four decisions this needed

### A. One surface list, two presentations — or two lists?

The quick-access page and the desktop tab strip show the same set today by
accident, not by contract. Two options:

- **One list, presentation chosen by the shell.** A contribution declares what
  it is (`panel`, `quick-access`, `drawer-section`) and the shell decides
  whether that becomes a tab, a card on the phone page, or both. Cheapest to
  keep coherent; the risk is a surface that only makes sense in one place
  having to say so anyway.
- **Two explicit lists.** A plugin says where it appears. More words per
  plugin, no surprises.

### B. How declarative, exactly?

"Declarative" can mean three quite different things, and they cost differently:

1. **Declarative manifest, imperative render.** `pi-web-plugin.json` (or a
   typed default export) declares id, title, icon, slots, capabilities,
   ordering and visibility rules; rendering stays a function. Small change,
   removes most host-method growth, and lets the shell reason about a plugin
   *before* loading its code — which is what makes lazy loading and code
   splitting possible.
2. **Declarative UI.** Contributions describe their content as data (rows,
   fields, actions) and the shell renders it. Strong consistency, but every new
   visual need becomes a schema change; our own panels (files, git, terminal)
   would not fit without escape hatches.
3. **Declarative wiring only.** Data sources and operations are declared;
   rendering stays free. Between the two, and the most useful for caching and
   prefetch because the shell learns what a surface needs before it opens.

### C. What `pi-web-official-plugins` actually is

- **A repository that publishes one npm package** containing all official
  plugins, installed with one command and discovered as a plugin root. Simple
  to install; every plugin ships on one version line.
- **A repository that publishes one package per plugin** plus a meta package
  that depends on them. Slower to release, but a user can take git without
  taking voice, and a broken plugin does not pin the rest.
- **Keep them in this repository** and publish the pack from here. No new repo
  to keep in sync; the tree stays large.

### D. What moves out of core

If the right-hand panels are all extensions, then the shell keeps: the chrome,
navigation, the transcript and composer, settings, and the plugin runtime. That
is a real boundary and worth stating in `AGENTS.md` once chosen, because the
temptation is to leave "just this one" panel in core.

## What is already true and should not be relitigated

- Plugins must not import from `src/client/src` directly; they borrow through
  the host seam. That rule is what let the chevron and close mark converge.
- Contributed surfaces answer availability honestly: an unanswered section
  renders no tab rather than an empty one.
- A plugin's dialogs go through the modal registry, not their own overlays.


## What the review found (three read-only lanes, 2026-09-09)

Full reports: `docs/design/research/plugin-core-boundary.md`,
`plugin-declarative-contract.md`, `plugin-discovery-and-loading.md`.

### Installing from GitHub is mostly already true

The pi package manager parses git sources, clones at a ref and installs, and
our plugin catalogue never asks whether a package arrived from npm or from git -
it reads `piWeb.plugins` from whatever path the package landed at. The gaps are
specific, not architectural:

- **A monorepo is not discovered.** Only the repository root `package.json` is
  read, so an official-plugins repository must declare every plugin at the root
  with paths into subdirectories, or ship one package per plugin.
- **A git install does not build.** Dev dependencies are omitted, so the
  repository has to commit its built browser modules.
- **Package size is budgeted** (files and bytes counted over the checkout), so a
  repository carrying sources, tests and docs can exceed it.
- **Pinning is the ref in the source string**, stored in the agent's settings.
- **One-step install does not exist**: a user must type a pi source string.

### Which manifest shape fits us

Surveyed: VS Code (`package.json#contributes`), Obsidian (`manifest.json` plus a
GitHub release whose tag matches the version - our source check on the exact
download mechanics came back *unclear*, so treat that detail as unverified),
HACS (a required directory layout), Zed (`extension.toml` plus a user-visible
capability list). The common shape is: a static file, read before any plugin
code runs, declaring contributions into named slots, with the version and the
release aligned.

Ours should stay `package.json#piWeb` - it is what discovery already reads, it
carries the npm and git paths for free, and it lets one repository declare
several plugins. What it must gain is the declaration itself.

### What a declarative contract has to cover

The lane measured our own plugins rather than theorising: the browser side uses
**56 distinct host context members** and **17 places that reach around the seam**
into browser or Node APIs. About 40 of the 56 collapse into declarations
(navigation, refresh, read, invalidate, configure); roughly 16 stay imperative;
13 named escape hatches cover every reach-around. Of eleven panels, **four**
could be rendered from a row/field/action vocabulary - so a declarative UI layer
removes repeated markup, it does not remove rendering.

The contract is also **declared twice** today: the published `src/plugin-api.ts`
and the internal `src/client/src/plugins/types.ts`, which does not import it.
The internal one has six extra context members, used only by core's own
pseudo-plugin. That drift is the first thing a declarative layer must close.

### Debts that block the boundary, with evidence

Eleven reach-arounds, the load-bearing ones being: core actions hard-code plugin
contribution ids; the drawer's generic `runCommand` seam is implemented as
`runGoalCommand`; the daemon's surface list hard-codes `goals` and `subagents`;
a host capability (files) depends on routes another plugin (workspaces) mounts,
with no way to declare that dependency; and the updates plugin reads a host
deployment flag out of its own module URL.

### Migration order that keeps the app usable

0. Land the declaration (placement, data, operations) with rendering still a
   function. 1. Browser-only plugins leave (info, relays, tasks, updates).
2. Web-process server plugins leave (workspaces, machines). 3. Capability-backed
panels leave (files, terminal), fixing the hard-coded action ids. 4. Goals,
which is where the special-casing is retired. 5. Cleanup, and the final core
list is written into AGENTS.md.


## The owner's second pass (2026-09-09)

1. **No plugin is mandatory.** Every surface must be able to be absent, and the
   app must remain usable and honest about what is missing. The local-machine
   fallback in core stays, because it is what makes "machines is not installed"
   a working state rather than a broken one.
2. **The activity pill is a plugin.** Subagent and background-task presentation
   follows the same rule as everything else. Its blocker is that the daemon's
   surface list hard-codes `goals` and `subagents`; that list has to become a
   declaration before the pill can leave.
3. **Updates, restart and fleet need a redesign**, along the line the owner
   drew: some things are kernel - the part a plugin must not be able to change.
   Proposal below.
4. **The phone machine switcher is declared by the machines plugin**, as two
   contributions, not re-rendered by the shell in a mode the shell chose.
5. **File routes become namespaced**, with the files-on-workspaces dependency
   declared rather than implied by a shared path shape. The federated route
   table follows.
6. **Official plugins: one repository, several packages, plus a meta package.**
   One-step install through the meta package; each plugin still pinnable on its
   own. This requires discovery to read more than the repository root, which is
   the one real code change the packaging choice implies.

## Kernel, core and plugins (proposal, for the owner's correction)

The owner's distinction is not "core versus plugin" but "what a plugin must not
be able to change". That is a third category, and naming it resolves the
updates/restart/fleet question without special cases.

**Kernel** - the machinery a plugin cannot alter, only ask:

- Process and session ownership: who owns a session, the daemon's runtime, the
  prompt queue, the operation ledger.
- The trust decision: which project is trusted, which plugin roots may load.
- Plugin lifecycle itself: discovery, install, enable, disable, update, restart.
- The transport: sockets, reconnection, request deadlines, machine proxying.

**Core** - what ships without any plugin and can be replaced by one:

- The shell: layout, routing, modal layers, theme application.
- The conversation: transcript, composer, delivery, activity.
- Session management: list, select, rename, archive, tree.

**Plugins** - everything else, and nothing is mandatory.

Applied to the open question: **self-update, restart and fleet membership are
kernel**, because a plugin that could rewrite the mechanism that updates and
restarts the host could make itself un-removable. The updates *panel* is a
plugin and stays one; it asks the kernel through a declared operation. The
bootstrap problem disappears: the kernel updates the host, including plugins;
no plugin updates the kernel.

The same rule settles two others for free: the trust reader and the plugin
catalogue are kernel, so no plugin can widen where plugins load from.
