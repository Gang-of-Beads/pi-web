# Go to scopes: global pages and project pages

Status: owner rulings 2026-10-05; built (steps 1–3; step 1 in `ddd27d0b`).

## The report

On a phone, with a session open and a tool page (Terminal) on screen, the reader tapped the grid
key: the Navigate page opened over Terminal, widened to "Local › All projects". From there Go to →
Terminal, or any other plugin page, did nothing visible.

Reproduced on a dev stack: Go to → Files set the main view
to `files:files` underneath while the Navigate overlay stayed on top (`navigateOpen: true`). Go to's
view destinations never closed the overlay; only Settings did (`closeNavigate()` first). And the
pages Go to offered belonged to the workspace selected behind the overlay, not to the scope the
reader was looking at, which was no project at all.

## The rule (owner)

A plugin's Go to entry comes in two kinds, and a plugin brings whichever it implements:

- a **global page**, about the machine on screen, which needs no project;
- a **project page**, about the selected workspace (the project's folder), as every plugin page is
  today.

When no project is in scope, Go to lists only global pages: a plugin with no global page has no
button there.

## Scope

Go to's scope is the scope the reader is looking at, named in one pure classifier:

| Opened from | Scope |
| --- | --- |
| a Navigate page (the overlay, or the phone's Sessions view) widened to the machine ("All projects") | machine |
| a Navigate page narrowed to the selected project, with a workspace selected | workspace |
| the app bar of a chat or plugin page, with a workspace selected | workspace |
| anywhere, with no workspace selected | machine |

The Navigate page owns its own scope (`pathProjectId`); it reports it, with the project it names,
when it asks for Go to, so the host never guesses it: project pages are offered only when the
selected workspace belongs to that project.

What Go to lists:

| Scope | Entries |
| --- | --- |
| machine | every global page, Actions…, Settings |
| workspace | every project page, the global pages of plugins with no project page, Actions…, Settings |

Go to lists pages only: the session list and the chat are not among them (owner, 2026-10-14; the
grid key reaches Navigate). Go to opens the list and closes whatever it shows, list or page
(owner, 2026-10-16); the next Go to starts from the list again. On the wide layout the list and
its pages sit in the page column, and Go to folds the column. Over a page, Back in the top-left of
that place (the column's bar, `AppColumnBar.ts`, or the conversation's bar where pages replace the
chat) returns to the list; there it covers the grid key, so the menu sheet carries the grid key.

One button per plugin page: a plugin that brings both kinds shows its project page in the
workspace scope and its global page in the machine scope.

Every view destination closes the Navigate overlay before it shows the
view, as Settings already did. A tap in Go to is never swallowed.

## Plugin API

A new contribution beside `workspacePanels`:

```ts
interface PluginContributions {
  globalPanels?: GlobalPanelContribution[];
}

/** A page about the machine on screen; it needs no project. */
interface GlobalPanelContribution {
  id: LocalContributionId;
  title: string;
  icon?: TemplateResult;
  order?: number;
  visible?: (context: GlobalPanelContext) => boolean;
  badge?: (context: GlobalPanelContext) => string | number | TemplateResult | undefined;
  toolbar?: (context: GlobalPanelContext) => TemplateResult;
  render: (context: GlobalPanelContext) => TemplateResult;
}
```

`GlobalPanelContext` carries the machine, the host and the plugin state; it has no workspace, no
prompt editor and no terminal, so a global page cannot reach a project by accident. Existing
`workspacePanels` are project pages, unchanged: no published plugin changes behaviour.

## Placement (owner: the desktop runs the phone's logic)

Go to opened from the phone's Navigate page follows its switch (`<project> | All projects`);
everywhere else, and on the desktop always, Go to follows what is open (below). The
desktop's right-hand column shows the page Go to chose.

- Phone: a global page is a main view like a project page; the app bar names it. Its URL carries
  `tool=<id>` and no project or workspace.
- Desktop: the right-hand column shows the chosen page, global or project; with no workspace
  selected it shows a chosen global page, where today it hides.

### The desktop's default scope (owner)

The navigation page opens on "All projects". Its switch only decides what the list shows; Go to
follows what is open: a project's session or page offers its project pages, nothing open (or a
global page) offers the global pages. On the phone, Go to opened from the Navigate page still
follows the switch. With a session open, the session decides, so a global page beside it on the
desktop does not narrow Go to to the machine.

## Built-in plugins

| Plugin | Kind |
| --- | --- |
| Updates (PI WEB updates for the shown machine) | global |
| Terminal | both: the project page as today, and a global page with a shell in the machine's home folder (owner) |
| Files, Git, Info | project |

Plugins installed separately (Goals, Subagents, Background runs) bring their own pages.

The global Terminal needs machine-level terminal routes in the web process and the session daemon
(today every terminal route is under a project and a workspace), so it is its own step and needs a
session daemon restart.

## Steps

1. Go to closes the Navigate overlay for every view destination, and lists project pages only in
   the workspace scope (the classifier above). No API change; until step 2 no plugin has a global
   page, so the machine scope lists Sessions, Chat, Actions… and Settings, and Updates is reached
   from a workspace.
2. `globalPanels` in the plugin API, the host placement on phone and desktop, the desktop's Go to
   following what is open (decided above), and Updates as a global page;
   the plugin docs and the API baseline follow.
3. Machine-level terminals in the daemon and the web routes, and the Terminal plugin's global page.
