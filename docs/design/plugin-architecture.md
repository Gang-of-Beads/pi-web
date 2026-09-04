# Plugin architecture: a minimal core, everything else a plugin

Status: draft for owner correction, living on `refactor/plugin-architecture`.
Nothing here ships to main until the boundary below is approved on paper and
the voice extraction proves the API against a real, demanding consumer.

## Why

Most defects in the checklist share one shape: a feature wired directly into a
core surface added a producer that a sibling surface did not know about. The
fix each time was to enumerate producers and pin them to one authority. A
small core with published extension points makes that enumeration structural:
a plugin cannot reach into core state, so it cannot become an unlisted
producer. pi itself is the working proof - a minimal agent loop, with tools,
commands, UI, rendering, and persistence all supplied through one
`ExtensionAPI` seam.

## The reference model (pi)

What pi exposes to extensions, and the pi-web analogue this design adopts:

| pi | mechanism | pi-web analogue |
|---|---|---|
| `export default function (pi: ExtensionAPI)` | single activation seam | `PiWebPlugin.activate(ctx)` (exists) |
| `pi.on(event, handler)` | lifecycle interception | client + daemon event buses (partially exists as socket events; not yet a plugin surface) |
| `pi.registerTool` | LLM-callable capability | daemon-side plugin services (new) |
| `pi.registerCommand` | user-invocable verb | `PluginAction` (exists) |
| `ctx.ui.select/confirm/input/notify` | interaction primitives | plugin runtime `notify` + dialogs (partial) |
| `ctx.ui.custom()` | full custom TUI component | plugin-rendered cards and panels (panels exist; cards are new) |
| custom rendering of tool calls/messages | display ownership | message/card renderer contributions (new; the core renders a fallback) |
| `~/.pi/agent/extensions/`, `.pi/extensions/` | trusted auto-discovery | `$PI_WEB_DATA_DIR/plugins/`, `<project>/.pi-web/plugins/` (catalog exists; project-local discovery to confirm) |
| `/reload` hot reload | dev loop | plugin dev-reload endpoint (new, dev-mode only) |

## Boundary: what the core is

The core is the part that must exist for "talk to a Pi session from a
browser" to be true, plus the process split that keeps sessions alive.

Core, kept and maintained by us:

- Session daemon: session runtime ownership, the sessiond protocol, realtime
  hub, prompt queue/delivery/acceptance, status truth, workspace providers.
- Web/API process: routing, static serving, machines/fleet proxying, auth.
- Client shell: machines - projects - workspaces - sessions navigation,
  the transcript (message list, streaming, reading anchor, delivery states),
  the composer (text, attachments, queue), settings shell, quick switcher,
  notifications surface, theme engine (the engine, not the themes).
- The plugin runtime itself: discovery, catalog, activation, contribution
  registries, and the typed contract package.

Everything else is a plugin. Existing precedent: `git`, `info`, `relays`,
`updates`, `workspace-tasks` already live in `pi-web-plugins/`; goals is an
extension-backed panel; themes are data-driven.

Extraction candidates, in migration order:

| candidate | today | plugin name | pulls out of core |
|---|---|---|---|
| voice/dictation | wired through PromptEditor, voiceController, azureSpeechFrames, liveDictation, pcmAudio, speech routes | `pi-web-voice` | composer button, audio capture, streaming frames, server speech proxy, settings section |
| terminal panel | TerminalPanel + daemon terminals | `pi-web-terminal` | panel UI; daemon pty service stays core (workspace provider) or moves behind a service contribution - owner call |
| goals | extensions/goal.ts + GoalPanel + goal store routes | `pi-web-goals` | panel, status chips, store routes |
| model picker extras | catalog browsing beyond bare selection | `pi-web-model-catalog` | dialog internals |
| themes beyond default pair | plugins/themes data | `pi-web-themes` | theme data; engine stays |

Explicitly not plugins: message sync/delivery, the outbox, session lifecycle,
ask/dialog settlement law, bottom anchor, breakpoints. These carry the
correctness invariants the design docs pin; a plugin seam through them would
re-open every producer question we just closed.

## Extension points (v1 contract)

Client, additions to the existing `PluginContributions`:

1. Message/card renderers. A contribution claims a message kind or a
   `custom` payload tag (mirroring pi's custom rendering). The transcript
   asks the registry before its built-in renderers; no claimant means the
   honest fallback card. Contract: pure render function over a frozen view
   model + the html tag; no reach into transcript state. Cards must obey the
   settled-outcomes and corner contracts by construction (the runtime wraps
   them in the standard card chrome).
2. Composer contributions: leading/trailing action slots (voice button
   lives here), draft transformers (dictation inserting text goes through
   the same seam the user's keyboard uses - one producer), attachment
   sources.
3. Settings sections: a contribution renders inside the settings shell with
   scoped storage; the shell owns navigation and persistence.
4. Client lifecycle events (read-only facts, not hooks that mutate):
   session selected/left, message arrived, connection state, theme applied.
5. Commands/actions and panels: as today, unchanged.

Daemon:

6. Plugin services: a daemon-side module a plugin ships, activated with a
   scoped context (session facts read-only, its own storage directory, the
   notification bus). This is where a speech proxy or a goal store lives.
   Never loaded into the web process; the process-ownership rule from
   AGENTS.md applies to plugin halves too.
7. Route contributions: `api/plugins/<plugin>/...` namespaced, declared not
   improvised, so the client URL convention holds.

Packaging and naming:

- One repo per plugin under Gang-of-Beads, named `pi-web-<name>`; npm scope
  `@gang-of-beads/pi-web-<name>`.
- A plugin is one package with up to three entry points: `client`, `daemon`,
  `web`. The manifest declares which exist; each process loads only its own.
- The contract lives in a published `@gang-of-beads/pi-web-plugin-api`
  package with semver discipline; core CI runs the published examples
  against the current runtime so a contract break fails here, not in a
  plugin repo.
- Bundled defaults (voice, terminal, goals) ship with pi-web so the default
  experience is unchanged; "plugin" is an architecture boundary, not an
  install burden.

## Migration rules

- One feature moves whole or does not move. A feature with a core path and
  a plugin path is two producers by construction and is forbidden.
- Voice goes first: it is named, heavy, and demands the widest API (audio,
  streaming, composer, settings, server proxy). The API is designed against
  its needs, then generalized - not the other way around.
- Every extraction wave gets the standing verification: multi-lane review,
  live 8505 probes for the touched flows, and the full suite green with the
  feature exercised through the plugin path only.
- main stays shippable throughout; refactor/* branches hold the work until
  a wave is whole.

## Open questions for the owner

1. Terminal: does the daemon pty capability stay core (a workspace
   provider) with only the panel as plugin, or does the whole capability
   move behind a service contribution?
2. Goals: extract now, or after voice proves the daemon service seam?
3. Project-local plugin discovery (`<project>/.pi-web/plugins/`): wanted, or
   machine-level only? pi requires project trust before loading local
   extensions; we would need the same gate.
4. Message renderer claims: first-writer-wins, or manifest-declared
   priority? (pi renders by entry kind; we have multiple plugins possibly
   claiming one custom tag.)
5. Is `pi-web-model-catalog` worth extracting, or does the picker stay
   core-minimal instead (fewer moving parts, same minimalism)?
