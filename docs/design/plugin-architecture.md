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

## Owner rulings (2026-09-04)

1. Scope: every candidate extracts, including theme data and the model
   catalog. Core keeps sessions, transcript, composer, navigation, the
   settings shell and the plugin runtime.
2. Terminal: the daemon pty capability stays core as a workspace provider;
   only the panel becomes `pi-web-terminal`.
3. Plugins live in their own private Gang-of-Beads repositories named
   `pi-web-<name>`, published under that scope.
4. Project-local discovery is wanted, with pi's project-trust gate copied.
5. Done means green on `refactor/*`: no merge to main, no release.

## Blocking order discovered during the voice wave

Voice's server half cannot move until extension point 7 exists: the plugin
runtime has no route contribution, so `web/speechRoutes.ts` has nowhere to go.
Removing `speechToText`/`azureSpeech` from the core config contract while the
route still lives in core would leave the feature half-migrated - a core path
and a plugin path for one behaviour, which is the multi-producer shape this
refactor exists to remove. The order is therefore: build route contributions
and the daemon service context, then move the speech route and the config
block together, then close the voice wave.

## Open questions for the owner

1. Message renderer claims: today a second claim on a tag is refused, and a
   gateway claim and a per-machine claim can coexist with order-dependent
   precedence. Keep the refusal, or move to manifest-declared priority?
2. Is `pi-web-model-catalog` worth extracting, or does the picker stay
   core-minimal instead (fewer moving parts, same minimalism)?

## Scan results (three bllm max lanes, 2026-09-04)

Consolidated from the client, server, and plugin-runtime scans; each claim
carries file:line evidence in the lane transcripts.

### Verified facts

- Voice is a closed set: 13 client modules + PromptEditor + the PiWebApp
  config plumb + api/speechToken + parsers. appState carries no voice field;
  no shortcut, palette entry, or status-bar indicator knows voice exists.
  The single render site is <prompt-editor> at PiWebApp. Extraction will not
  require core-store surgery.
- Server voice is one module: web/speechRoutes.ts. Terminal splits cleanly
  into a daemon half (terminals/terminalService, nodePtySpawnHelper,
  terminalRoutes) and a web proxy half (terminalProxyRoutes). Goals server
  side is web/goals/* plus two goal routes embedded in
  workspaceExplorerRoutes (lines 42/58) that must move out with the plugin.
- Core leak found: the daemon hardcodes goal tool names and the
  goal-continuation marker (injectedTurnKinds.ts:41-43, pluginSurfaces.ts:31)
  and a subagents surface. These become plugin-declared facts, not core
  constants, in the goals wave.
- The daemon already has a plugin boundary seam (pluginBackendRoutes,
  workspaceProviderRegistry) but its activation contract contributes exactly
  one thing (workspaceProvider) with a minimal context (logger, settings,
  execFile, signal).

### Gap matrix (v1 extension points vs today)

| # | extension point | status | note |
|---|---|---|---|
| 1 | message/card renderers | MISSING | transcript dispatch is hardcoded in ChatView; no registry call site |
| 2 | composer contributions | MISSING | PromptEditor has zero plugin imports; only host-to-plugin insertText capability exists |
| 3 | settings sections | MISSING | SettingsSection is a closed union of 7 core literals; plugins cannot name a section |
| 4 | client lifecycle events | MISSING | activation context is frozen identity+tags; no subscribe API and no teardown hook at all |
| 5 | commands/actions/panels | EXISTS | PluginAction + WorkspacePanelContribution, registered and consumed |
| 6 | daemon services | PARTIAL | ServerPluginActivation.workspaceProvider only; context lacks storage, session facts, notification bus |
| 7 | route contributions | PARTIAL | pluginBackendRoutes / proxy routes exist; no declared namespace manifest |

### Catalog corrections from the scan (absorbed into v1)

- F1: composer contributions gain a status/hint region (voice renders
  Listening/Transcribing/permission-refused lines inside the composer; the
  action-slot catalog alone cannot absorb it).
- F2: plugin config delivery. Voice config rides PiWebConfigValues through
  the core parser and api/config transport end to end. v1 adds
  plugin-declared config keys: a plugin manifest names its config block, the
  core parser validates it as an opaque namespaced value, and the plugin
  receives it through its activation context with change notification. Core
  stops naming azureSpeech/speechToText in its own contract when voice moves.
- Teardown is a prerequisite, not an afterthought: plugins get a dispose
  seam alongside every subscription-bearing API before any event bus ships.

### Build order on this branch

1. Contract wave: composer contributions (slots, status region, draft
   transformers), client lifecycle events with dispose, plugin-declared
   config keys. Types + registry + tests first, no consumer change.
2. Consumer wave: PromptEditor and SettingsDialog read the registry;
   built-in behavior unchanged (core renders through the same seams it
   publishes - one producer).
3. Voice extraction into pi-web-voice consuming only published seams;
   speechRoutes moves behind the route contribution manifest.
4. Message/card renderer seam, then daemon service context enrichment,
   then goals/terminal waves per the owner's open-question answers.

## What pi's own extensions teach (read 2026-09-04)

Read against `examples/extensions` and `docs/extensions.md` in the bundled pi
package. Three differences are worth naming, because pi has already paid for
its choices.

1. **Push, not pull.** pi's UI seams are `ctx.ui.setStatus(key, text)` and
   `ctx.ui.setWidget(key, lines, { placement })`: the extension pushes named
   content when its own state changes, and the host never asks. Our composer
   status is pull-based - the host calls `status(context)` while rendering -
   which is why the composer needed a `requestUpdate` seam at all. The pull
   model also means a plugin's render function runs on the host's schedule
   rather than its own. Aligning would remove one seam rather than add one,
   and it is the shape to converge on before more surfaces copy the pull
   pattern. Not changed yet: voice is the only consumer, and changing the
   contract and its consumer in one wave is how a half-migrated feature gets
   two paths.
2. **Durable entries have a producer.** pi pairs `registerEntryRenderer(type,
   renderer)` with `appendEntry(type, data)`, so the same extension that draws
   a card is the one that puts it in the session. Our renderer seam has no
   browser-side producer by design - custom entries arrive from pi extensions
   through the transcript - which is coherent, but it means a pi-web plugin
   can render a card it can never create. If a plugin should be able to write
   one, that producer belongs in the daemon half, not the browser half.
3. **Renderers get view state and theme.** pi hands its renderer
   `(entry, { expanded }, theme)`. Ours hands a frozen view model and no
   expansion state, so a plugin card cannot offer a collapsed and an expanded
   form the way built-in tool results do. Worth adding when the first card
   wants it, not before.

The parts we already match: a single activation function per plugin, named
contributions rather than host edits, capability objects handed in rather than
imported, and refusal of anything the plugin did not declare.

## Terminal wave: what the panel still needs (2026-09-04)

The terminal panel is already a contribution, so moving it looked like a file
move. It is not: the panel imports six host things a plugin may not reach -
the terminal routes and socket, the clipboard helper, the error-describing
notice helper, the shared interactive-surface styles, and the coarse-pointer
breakpoint query. Moving the files without those seams would have produced a
plugin that imports core internals, which the bundled-plugin guard rightly
refuses.

Done in this wave, because both are right regardless of when the panel moves:

- The terminal capability handed to workspace panels now includes the pty
  sessions themselves - list, start, close, closeAll, continue, connect - with
  machine, project and workspace bound once by the host. A panel asks for a
  terminal; it does not know how one is reached. This is the seam the owner's
  ruling requires: pty stays core, the panel becomes a plugin.
- The two pure selectors that decide which terminal a panel shows are split
  out of the selection-memory module, so the panel's decision and the host's
  storage stop sharing a file.

Still owed before the panel can move: plugin-visible clipboard, error text,
surface styles, and breakpoint seams. Each is small; together they are the
next bounded task, and doing them first keeps the panel from moving as a
half-migrated feature.

## Themes wave: blocked on one contract mismatch (2026-09-04)

Attempted and reverted rather than left half-done. Moving the theme pack into
its own package is a two-line change until the types meet: the internal
`ThemeTokens` is `Record<ThemeToken, string>` - a closed union that makes a
missing token a compile error, which is why every shipped theme is complete -
while the published `ThemeTokens` is `Record<string, string>`, and the
published `QualifiedContributionId` is a plain string where the internal one is
a `plugin:contribution` template. A pack typed by the public contract is
therefore not assignable to the internal one, and every route around that ends
in a type assertion this repository forbids for good reason.

The fix is to align the two contracts, not to cast: publish the token union so
a plugin theme is complete by construction too, and publish the qualified-id
shape the host actually mints. That is its own change with its own tests, and
it is the next task in this wave. Reverting kept the tree green and kept the
pack from existing in two places.

Also observed while there: the pack is registered in-app today, so themes are
present on first paint. As a discovered plugin it would load with the others,
and the first frame would use the stylesheet defaults. Whether that is
acceptable is a product question for the owner, not something to decide inside
a refactor.
