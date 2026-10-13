# Go to keys: declared by plugins, or brought by an extension's widget

Status: approved by the owner (2026-10-07).

## The request

The owner, on why Goals and Subagents sat in Go to next to the pages an
extension draws with `setWidget` (paraphrased): each extension gets its own key
in Go to. The duplicates come from PI WEB accommodating what it should not:
Goals is a plugin, so the goals plugin should declare that it needs a key, and
behind it is its own page; the same for subagents. Many extensions draw with
pi's `setWidget`; find a way to map that onto our model. And on the approved
design: do it, and let the plugin define the name shown.

Earlier rulings this keeps: nothing an extension draws goes in the
conversation or around the composer (2026-10-06: it hides the view and blurs
what is conversation and what is a plugin); plugins live in Go to; PI WEB
favours no particular plugin (2026-10-07).

## What was wrong

- Goals and Subagents are PI WEB plugins bundled in this repository, and their
  keys showed whether or not the session had loaded pi-goal or pi-subagents.
  The daemon still reports, per session, whether anything registers their
  tools (`pluginSurfaces`), and the browser still parses it, but nothing has
  read it since the session drawer was removed (f44c06bc): the gate was lost
  with the drawer.
- The subagents half of that report was a constant in the daemon
  (`SUBAGENT_TOOLS`), and the wire type named both surfaces: core naming
  plugins.
- `setWidget` drew nothing (withdrawn 2026-10-06, extension-ui-counterpart.md).

## Design

### 1. A plugin key that fronts an extension shows only with it

A server plugin already declares the surfaces it fronts and the tools that
prove one is backed (`agentFacts.surfaces`, agentSurfaceDeclarations.ts); the
goals plugin does. The subagents plugin declares its own (`subagents`, tool
`subagent`) and the daemon's constant goes. The daemon reports every declared
surface by name (`pluginSurfaces: Record<surface, state>`), so the wire names
no plugin.

A workspace or global page says which surface it fronts (`fronts: "goals"`).
Go to leaves the key out while the session on screen reports that surface
`absent`. `failed` keeps it (a load error is not absence, and the page says
why), and so does an unknown answer: no session on screen, or a daemon that
does not report. Absence is not negation.

### 2. An extension's widget brings its own key

pi gives every extension the same `ctx.ui`, so a `setWidget` call does not say
who made it. The call site does: the daemon reads the caller's file from the
call stack (pi loads extensions through jiti, which keeps their file paths,
helper files and timer callbacks included; measured 2026-10-07) and matches it
to the loaded extension whose extent holds it. That gives the extension
and the Pi package it came from.

An extension's extent is pi's own record of where it came from
(`sourceInfo`), never a search upward: an installed package is its install
directory, and an entry of an extensions folder (`~/.pi/agent/extensions`,
`<project>/.pi/extensions`) is that file or that entry's directory. The
first version searched upward for a package.json, found the one in the home
directory, and made one single-file extension the author of every widget;
the daemon's own frame is dropped before the stack is read for the same
reason.

- From an extension's first widget in a session, Go to has a key for that
  extension. Its page shows each of the extension's widgets under its key, as
  the terminal draws it, and follows every update. A cleared widget leaves the
  key, with the page saying the extension shows nothing now; a reload of the
  session's extensions removes it.
- An extension a plugin fronts (one that registers a tool of a declared
  surface) brings no key: its plugin's page is the key.
- A call no loaded extension can be matched to is shown under its widget key.
- An extension's page is a project page (it hangs off the session's workspace),
  so Go to offers it while a project is in scope: not on the Navigate page's
  machine scope, nor for a session opened with no project selected.
- Only a page on screen that fronts the surface takes an extension's widgets:
  with the plugin's page missing here (its browser module failed, or it was
  disabled before the daemon restarted), the extension keeps its own key
  (found in review).
- Clearing a key that held nothing leaves nothing: pi-background-tasks clears
  its widget at every turn and never sets one, and brings no key.

### 3. The name is the plugin's

A PI WEB plugin names its page (`title`), as today. A Pi package names the key
its extensions' widgets bring with `piWeb.title` in its `package.json`; without
it the key is the package's name, and without a package the extension file's
name. pi's own manifest has no display name.

## Steps

1. Section 1: surfaces by name, the subagents declaration, `fronts` on pages,
   Go to's gate. Goals and Subagents declare `fronts`.
2. Section 2 and 3: the daemon keeps attributed widgets; Go to adds a key per
   unfronted extension; the host draws its page.

Measured on a dev stack (2026-10-07) with the extensions that machine ran plus a
probe extension in the project's `.pi/extensions` that draws from a helper
file and a timer: pi-goal's widget came back as pi-goal-x fronting `goals`
(no key; Goals stands for it), pi-subagents' as fronting `subagents`,
pi-background-tasks brought nothing, and the probe brought a "Widget probe"
key (its `piWeb.title`) whose page showed its widget, full page on a phone
and in the right-hand column on a desktop.
