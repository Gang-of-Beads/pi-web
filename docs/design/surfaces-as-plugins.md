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

## The four decisions this needs

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
