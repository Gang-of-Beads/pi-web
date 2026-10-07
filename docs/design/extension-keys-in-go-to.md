# Go to keys: declared by plugins, or brought by an extension's widget

Status: approved by the owner (2026-10-07, asks `3b1b7159`, `84329bab`).

## The request

The owner, on why Goals and Subagents sit in Go to next to the pages an
extension draws with `setWidget`:

> 每个扩展在 goto 各有一个，你现在重名肯定是因为pi web 你兼容了不该兼容的东西，比如goals，
> 他明明是个插件，你为什么还要把他放到 pi web的原生 go to按钮里呢？ 应该有goal插件声明需要一个按钮，
> 然后里面才是他自己的页面啊。subagents同理。当然我理解很多插件是用setWidget（pi的插件的接口）来实现的，
> 你看看有没有办法和我们的逻辑对应上

(Each extension gets its own key in Go to. The duplicates come from PI WEB
accommodating what it should not: Goals is a plugin, so the goals plugin should
declare that it needs a key, and behind it is its own page; the same for
subagents. Many extensions draw with pi's `setWidget`; find a way to map that
onto our model.) And on the approved design: "可以按这个做，但是显示的名字可以由插件自己定义"
(do it, and let the plugin define the name shown).

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
to the loaded extension whose directory holds it. That gives the extension
and the Pi package it came from.

- From an extension's first widget in a session, Go to has a key for that
  extension. Its page shows each of the extension's widgets under its key, as
  the terminal draws it, and follows every update. A cleared widget leaves the
  key, with the page saying the extension shows nothing now; a reload of the
  session's extensions removes it.
- An extension a plugin fronts (one that registers a tool of a declared
  surface) brings no key: its plugin's page is the key.
- A call no loaded extension can be matched to is shown under its widget key.

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
