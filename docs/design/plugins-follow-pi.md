# Plugins that follow pi's philosophy

Owner, 2026-11-24: "the plugins must not depart from pi's philosophy, our own plugin API and the
bundled plugins included." Evidence: three read-only audits of main (state, core/plugin boundary,
the plugins themselves); their reports are under the session's subagent artifacts.

## What pi does

A small core that knows no extension. Everything else arrives through generic insertion points. pi's
core has no notion of background work: an extension shows state as its own strings (`setStatus`),
its own entries (`appendEntry` + a renderer) and by holding the turn open (`agent_settled`).

## Where PI WEB stands

Holds today
- Rule 1 of pi-insertion-points.md is real: a pi extension with no web part works in PI WEB (tools,
  commands, renderers, dialogs, status line, widgets, shortcuts, completions).
- No production core code names a plugin id; `pluginSurfaces`, `fronts`, `agentFacts` are generic.

Departs
1. Session state is a closed core set (asking, error, working, opening, background, idle) written into
   8 `Record`s and 5 ordered ladders. `background` is not core's to know: core counts its own
   subsessions and adds one integer from every plugin (`backgroundWork`). A plugin cannot name, colour
   or rank its own state, cannot see any session's state but the selected one, and a list item handed
   to a plugin carries no state at all.
2. Three product domains are core wearing a plugin folder: updates (all server routes, a 700-line
   status service, the strip and its own restart live in core; the plugin is a page reading five
   "host-internal" members), machines (registry face, proxy families, a fallback copy in core),
   workspaces (private ports; Files 404s when Workspaces is off).
3. Bundled plugins can do what third parties cannot: their HTTP routes are in core's gateway table, a
   third party's are not proxied; reserved action ids need unstable context to satisfy.
4. Dead or unreachable API: `navSections` and `workspaceLabels` have no surface that opens;
   `agentFacts.injectedTurns` is parsed and never read.
5. Plugins that draw another package's state do it around pi: `goal` restates pi-goal's storage
   format with no version; `background-runs` rebuilds pi-background-tasks' registry from disk, scans
   the transcript, runs `ps`, and writes a file into that package's directory; neither it nor
   `workflows` declares the surface it depends on.

## Target

### 1. State: core knows its own, plugins declare theirs

- Core states are what core observes of the pi runtime: asking, error, working, opening, idle.
- A plugin's server part declares session states through one generic hook, replacing `backgroundWork`:
  `sessionStates(session) -> [{ id, label, count?, tone, busy }]`.
  `busy` is the one behavioural property: a busy state ranks with working, holds the list order,
  blocks a folder rename and delays "settled". `tone` is a colour token; `label` is the plugin's words.
- The daemon publishes them with the session's status, for every session, scoped to plugin and
  machine; absent means unread, never zero. Every consumer (dot, order, dock, tags, quick switcher,
  rename blocker) reads core state + declared states through those properties, with a fallback for a
  state it does not know. The two classifiers that disagree today (Navigate and the switcher) become
  one.
- `background` becomes a declared state. Core's own subsessions are declared by the `core` plugin
  through the same hook; background-runs and subagents declare theirs. `backgroundWork` stays as a
  compatibility shim for one release, mapped to a declared state.
- Plugins see state: `ListItem`, section claims and `fleet.sessions` carry the merged states, so a
  plugin can label or section on its own state without a private map.

### 2. Updates becomes a real plugin; the strip becomes a generic slot

- Core keeps only what concerns the page itself: "this page is older than its server" -> Reload.
- New generic contribution `shellNotices`: a plugin offers a notice (words, tone, actions) for a
  machine. The strip draws notices; it knows no restart.
- Updates owns restart, update, version status and the fleet: its server part owns the routes; its
  browser part contributes the notice for the page's server and for the selected machine (owner,
  2026-11-24: one tap restarts, the daemon asks first, the page reloads when it is current; the strip
  also reports the selected machine). Where a host cannot restart itself the notice opens Updates,
  which says why. Core loses restartFromStrip, restartPiWeb, restartHasLanded, the status poll.

### 3. One API for bundled and third-party plugins

- The gateway proxies any plugin's routes generically (`api/plugins/<id>/routes/*`), so a bundled
  plugin's path is no longer in core's table and a third party's reaches remote machines too.
- The five host-internal members Updates needs become published context, or operations.
- Remove what nothing reaches: `navSections`, `workspaceLabels` (their content moves to
  `listSections` / `listLabels`), `injectedTurns`.

### 4. Machines, workspaces, files, terminal: say what they are

Machine, project and workspace are PI WEB's own nouns: every list and every route is scoped by them.
Proposal: they are core, and the code says so (the registry and file routes move out of the plugin
folders; the fallback copy goes). Files and Terminal stay plugins and draw through public API only;
the shell stops defaulting to a slot by name and opens the first page a plugin offers.
Alternative: keep them plugins and open every seam they use, so a third party could replace them.

### 5. Plugins that front another package

- Each declares the surface it depends on (`agentFacts.surfaces`, `fronts`), so "extension absent"
  shows as it does for goal and subagents.
- A store a plugin reads carries a version the plugin checks; background-runs stops writing into
  pi-background-tasks' directory.

## Order

1. State model (section 1) + the two classifier/doc fixes it uncovers.
2. `shellNotices` + Updates owns restart (section 2). Supersedes the "move Restart into Updates" task.
3. Generic plugin routes through the gateway + dead API removal (section 3).
4. Machines/workspaces/files/terminal per the decision in section 4.
5. Fronting plugins (section 5), in their own repositories.
Each step is its own pull request with review and a live run on the dev stack; steps 1 and 2 change
the session daemon and the plugin API baseline.

## Compatibility

A daemon and a page of different versions meet in every upgrade. New state data arrives as new
optional wire fields; old pages ignore them and keep `backgroundRunCount`, which the daemon keeps
sending for one release. Strict parsers that drop a whole frame on an unknown value get a fallback
first.

## Decisions (owner, 2026-11-24)

- Section 1: accepted. `background` leaves core; plugins declare states.
- Section 2: reversed. Updates becomes core, all of it (routes, status, page, strip actions). No
  Updates plugin. Adds: a silent background auto-update option, by default only on Wi-Fi, adjustable
  on the Updates page to include mobile data (session 01a13925, 2026-11-23).
- Notices: one generic bar with two kinds. Standing (Reload, Restart): stays until acted on. Passing
  (an error): has a maximum display time and a plain x. Undo shows only for a deletion; archiving no
  longer shows it.
- Section 4: machines and workspaces are core.
- After the API changes, every Gang-of-Beads extension follows (background-runs, subagents, ...).
- Release after the state model and Updates are done.
- Open: an interface an extension can expose over PI WEB's own transport ("bus"); see the API review.

## API review (2026-11-24): what else departs

1. Privilege: bundled plugins use `routes`, `ports.*`, `machineRegistry`, `fetchJson`, reserved action
   ids and unpublished context members; a third party cannot. With machines, workspaces and updates
   in core, every one of these can be deleted from the plugin API instead of published.
2. Closed vocabularies a plugin cannot extend: session states (section 1), machine status flags
   (`CORE_STATUS_FLAGS`), host facts (`dockerMode`), Settings sections (plugin sections only append),
   themes (core's two bypass the `themes` kind), default pages (`core:workspace.files`).
3. Dead or duplicate surface: `navSections`, `workspaceLabels`, `sessionSections` (duplicate of
   `listSections`), `agentFacts.injectedTurns`, `piWebUnstable`.
4. Thin facts: a plugin sees state for the selected session only; `ListItem` and `FleetSession` carry
   none; a section cannot order its own rows.
5. Two halves, no contract: a plugin that draws another package's data reads its files; nothing in the
   API lets a pi extension publish to its web part except drawing. The bus (below) is the missing
   insertion point.
6. pi insertion points still partial: markdown transformers only on finished text, `onTerminalInput`
   Esc only, `registerFlag` unused, `renderShell: "self"`, `setEditorComponent`.

## The bus

Exists: a plugin's server part declares named `operations`; its browser part calls them with
`callOperation`, and the gateway carries the call to whichever machine the copy belongs to. That is
already transport-agnostic request/response.
Missing: (a) a pi extension with no server part cannot offer one; (b) nothing is pushed, only asked;
(c) one plugin cannot call another's.
pi already has an inter-extension event bus (`pi.events`). Proposal: the daemon bridges it. A channel an
extension emits on is delivered to the browser parts subscribed to it on any machine, and a request
on a channel reaches the extension's handler; operations stay as the server-part form of the same
thing. Then "state an extension publishes" and "an interface an extension exposes" are one mechanism,
and it works in the terminal unchanged because it is pi's own.

- Bus (owner, 2026-11-24): built on `pi.events` provided the terminal is unaffected and the semantics
  are complete (checked: extension-bus.md, "In the terminal"); only declared channels leave a session;
  names follow pi's own owner-prefix convention; an extension declares its session states on the bus
  (`piweb:states:<owner>`), so section 1's hook is a channel, not a server-part callback.
