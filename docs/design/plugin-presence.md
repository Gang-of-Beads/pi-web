# Knowing whether a plugin is installed

Status: finding for task-1. No code changed yet.

## The question

PI WEB renders a Goals drawer tab and a subagents section whether or not the
plugins that produce them are installed. A user reported the subagents case;
the Goals case has the same shape.

## What the interface does today

It never asks. It infers, from data:

- `src/client/src/components/ChatView.ts:1343` renders the Goals tab
  unconditionally - there is no guard of any kind on the button.
- `src/server/web/goals/goalStore.ts:11` reads `.pi/goals` under the workspace
  and treats a missing directory as an empty list.
- `goalsDrawerTabLabel` (`ChatView.ts:3392`) shows `Goals N` once loaded and
  `Goals` before that, so the label distinguishes *loading* from *loaded* and
  never distinguishes *absent* from *empty*.

So the interface answers "are there goal files" and presents it as if it had
answered "is the goal plugin here". Those differ in exactly the case that
matters: a user who never installed the plugin sees a permanent empty panel
with nothing saying why.

## The runtime does expose the answer

Verified in the installed SDK:

- `ResourceLoader.getExtensions(): LoadExtensionsResult`
  (`node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader.d.ts:30`,
  implementation at `core/resource-loader.js:203`).
- `LoadExtensionsResult` is `{ extensions: Extension[], errors: Array<{path, error}>, runtime }`
  (`core/extensions/types.d.ts:1330`).
- `Extension` carries `path`, `resolvedPath`, `sourceInfo`, and - most usefully -
  `tools`, `commands`, `handlers`, `flags` as maps
  (`core/extensions/types.d.ts:1315`).
- The loader hangs off the session PI WEB already holds:
  `AgentSession.resourceLoader` (`core/agent-session.d.ts:120`).

PI WEB already uses this object. `piSessionService.ts:450` and
`sessionCommandService.ts:17` declare a narrowed structural type exposing only
`getSkills()`. Widening that declaration to include `getExtensions()` is the
whole of the plumbing; no new dependency and no new process boundary.

## A better predicate than "is the plugin installed"

`errors` matters as much as `extensions`. An extension that failed to load is
neither installed-and-working nor absent, and reporting it as absent would hide
a broken install behind a tidy empty state.

And the honest question for a panel is not "is package X present" but "does
anything provide this surface". `Extension.tools` and `Extension.commands` name
what each extension contributes, so the Goals panel can ask whether any loaded
extension registers the goal tools rather than matching a package name that a
fork or a rename would break. This repository runs a *fork* of the goal plugin
(`VincentHanxiaoDu/pi-goal`, a fork of `tmonk/pi-goal-x`), so a name match would
have been wrong here on day one.

## Recommendation

Three states per plugin-backed surface:

| state | how it is known | what the surface should do |
|---|---|---|
| absent | no loaded extension provides the tools | do not render the surface |
| failed | `errors` names it | render, and say it failed to load |
| present | an extension provides the tools | render as today |

The failed state is the reason not to collapse this to a boolean: today a
plugin that throws on load looks exactly like a plugin nobody installed.

## Open decision for the owner

What an absent surface should do - disappear entirely, or remain visible with
an explanation and an install hint. Disappearing is cleaner; a hint is more
discoverable for someone who does not know the feature exists. This is a
product call and the objective reserves it.
