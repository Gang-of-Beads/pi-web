# Go to scopes: global pages and project pages

Status: owner ruling 2026-10-05 (ask `fed78182`), design for review.

## The report

On a phone, with a session open and a tool page (Terminal) on screen, the reader tapped the grid
key: the Navigate page opened over Terminal, widened to "Local › All projects". From there Go to →
Terminal, or any other plugin page, did nothing visible.

Reproduced on 8505 (`/tmp/surfaces/goto-over-navigate-phone.png`): Go to → Files set the main view
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

The Navigate page owns its own scope (`pathProjectId`); it reports it when it asks for Go to, so
the host never guesses it.

What Go to lists:

| Scope | Entries |
| --- | --- |
| machine | Sessions, Chat, every global page, Actions…, Settings |
| workspace | Sessions, Chat, every project page, the global pages of plugins with no project page, Actions…, Settings |

One button per plugin page: a plugin that brings both kinds shows its project page in the
workspace scope and its global page in the machine scope.

Every view destination (Sessions, Chat, any page) closes the Navigate overlay before it shows the
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

## Placement

- Phone: a global page is a main view like a project page; the app bar names it. Its URL carries
  `tool=<id>` and no project or workspace.
- Desktop (no Go to sheet): the right-hand page column lists global pages beside the project
  pages; with no workspace selected it shows the global pages alone, where today it hides.

## Built-in plugins

| Plugin | Kind |
| --- | --- |
| Updates (PI WEB updates for the shown machine) | global |
| Files, Git, Terminal, Goals, Tasks, Relays, Info | project |
| Subagents, Background (per session, inside a project) | project |

A global Terminal (a shell in the machine's home folder) would be new behaviour; it is not built.

## Steps

1. Go to closes the Navigate overlay for every view destination, and lists project pages only in
   the workspace scope (the classifier above). No API change; until step 2 no plugin has a global
   page, so the machine scope lists Sessions, Chat, Actions… and Settings, and Updates is reached
   from a workspace.
2. `globalPanels` in the plugin API, the host placement on phone and desktop, and Updates as a
   global page; the plugin docs and the API baseline follow.
