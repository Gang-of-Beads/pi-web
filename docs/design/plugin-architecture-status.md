# Plugin architecture: what exists, and what does not

State of the `refactor/plugin-architecture` branch. This is the delivery
document the first version owes: what the core is now, what a plugin can do,
what was verified and how, and the gaps that are known rather than discovered
later by a user.

## The core, as built

Core keeps what a browser session cannot exist without: the session daemon and
its protocol, prompt delivery and the owned queue, the realtime hub, status
truth, workspace providers including the pty, the web/API process, and the
client shell - navigation, transcript, composer, settings shell, theme engine,
model selection, and the plugin runtime itself.

Model selection stayed core deliberately, matching pi, where `/model` and
Ctrl+P are core commands and extensions only observe `model_select`.

## What a plugin can contribute

| # | Extension point | State |
|---|---|---|
| 1 | message/card renderers | built, consumed by the transcript, unclaimed tags render an honest unknown card |
| 2 | composer contributions | built, consumed; voice's control and status line ride it |
| 3 | settings sections | built, consumed; an absent plugin's section says it is unavailable |
| 4 | client lifecycle events | built, with dispose; one listener throwing cannot silence siblings |
| 5 | commands/actions/panels | pre-existing, unchanged |
| 6 | daemon services | built: named JSON operations, per-plugin durable storage, scoped settings |
| 7 | route contributions | built: `api/plugins/<plugin>/<operation>`, the host owns the path |

Host utilities handed to plugins rather than copied by them: clipboard, error
wording, interactive-surface styles, breakpoints, and a JSON fetch that keeps
URL resolution in one place.

## Extracted

- `pi-web-voice` - the whole feature: 13 modules, the composer control, the
  status line, the settings block, and the token-minting daemon operation.
  Core contains no voice, dictation or speech code, and its config contract no
  longer names `speechToText` or `azureSpeech`.
- `pi-web-terminal` - the panel. The pty stays core as a workspace capability,
  per the owner's ruling; the panel reaches it through a capability whose
  machine, project and workspace the host binds once.
- `pi-web-themes` - the pack. The engine stays core; the themes are data.

Each has a private Gang-of-Beads repository seeded by `git subtree split`.
pi-web remains the single source until the contract package publishes.

## Verified

- No 8505 stack listening while testing: `tsc` clean, `eslint` clean,
  582 test files, 5303 passing, 5 skipped, zero unhandled errors.
- Live on the 8505 stack: all eight bundled plugins import in a real browser;
  the registry reports themes from the plugin, `terminal:terminal` among the
  workspace panels with core keeping only Files, and `voice:dictate` in the
  composer; a terminal session was created through the capability down to the
  daemon pty; the composer's Dictate control renders at 393x850.
- Four review lanes (two glm max, one qwen max, one red team) over the
  extraction commits; triage in `review-triage-extraction-waves.md`.

Live verification found four defects the suites could not, each because a unit
test constructs a class directly while a browser must resolve and evaluate a
module: extensionless imports, a mismatched decorator dialect, a lazy import
that became a chunk that never ran, and a reserved id that refused the theme
pack. The guards added for the first three now walk the shipped module graph.

## Known gaps

- **The pack loads with the other plugins, not before first paint.** Themes
  were app code registered in-app; as a plugin they arrive when discovery
  does, so the first frame uses stylesheet defaults. A product question for
  the owner, not a refactor decision.
- **Renderers get no expansion state or theme**, unlike pi's, so a plugin card
  cannot offer a collapsed and expanded form. Worth adding when a card wants
  it.
- **Status is pulled, not pushed.** pi's extensions push named status and
  widgets; ours are asked during render, which is why the composer needed a
  `requestUpdate` seam. Converging on pi's shape removes a seam rather than
  adding one, and should happen before more surfaces copy the pull pattern.
- **A plugin can render a card it cannot create.** The renderer seam has no
  browser-side producer by design; if one is wanted it belongs in the daemon
  half.
- **goals is not extracted.** The daemon still hardcodes goal tool names and
  the continuation marker; that wave is not started.
- **Nothing is published.** `@gang-of-beads/pi-web-plugin-api` has to publish
  before a split repository can build against a version instead of against
  pi-web's working tree.

## Audit verdict, 2026-09-04: first version not complete

An independent audit rejected the completion claim, correctly. Three task
contracts are unmet, and two of them are named in the objective's own
extraction list. Recorded here so the next session starts from the verdict
rather than from the claim:

1. **goals is not extracted.** `web/goals/*`, the two goal routes inside
   `workspaceExplorerRoutes`, `GoalPanel` and the daemon's hardcoded goal tool
   names (`pluginSurfaces.ts`) and continuation marker (`injectedTurnKinds.ts`)
   are all still core. Nothing of this wave has started.
2. **model catalog stayed core.** Matching pi is a defensible reason and the
   owner approved it in conversation, but the goal text lists it as an
   extraction target, so the objective itself needs amending before this can
   count as satisfied - a documented rationale is not an amended contract.
3. **No plugin is loaded from a package.** The split repositories exist and
   carry real history, but `@gang-of-beads/pi-web-plugin-api` is unpublished
   and pi-web still loads every plugin from `pi-web-plugins/`. The contract's
   decisive clause - pi-web loading at least one plugin from a package, proven
   live - is unmet.

Order for the remaining work: extract pi-web-goals whole (client panel, server
store and routes, and the daemon facts becoming plugin declarations rather than
constants), then publish the contract package and switch one plugin to
package loading with a live proof, then re-run the sign-off.

## Goals wave and package loading, 2026-09-04: closed

The three audit items above, updated from the work since the verdict:

1. **goals is extracted.** The server store, archive and file live in
   `pi-web-plugins/goals/server` behind `goals.read` and `goals.archive`;
   the core routes are a thin proxy. The daemon no longer hardcodes goal
   facts: the tool names and the continuation marker are the plugin's
   `agentFacts` declarations. `GoalPanel`, `goalProgress` and the goals
   slot left core with the wave: the plugin fetches its own goals through
   its own operation and keeps its own three-state slot, and the chat
   drawer and the navigation panel both draw it as a contributed section -
   neither imports a component nor holds a feature's state. Verified live
   on the 8505 stack: the tab renders "Goals 1 open" with the real
   objective text, fetched through `api/plugins/goals/goals.read`.
2. **model catalog still needs the owner.** The extraction list in the
   objective names it; matching pi argues for keeping it in core. The
   objective itself must be amended or the catalog extracted; neither is
   this session's to decide.
3. **A plugin loads from a package.** Proven by a test that builds a real
   tarball, installs it the way pi installs a package, and asks the
   catalog what it found - with no directory root offered, so a pass
   cannot come from the bundled copy. It answers with the package under
   `node_modules` and no diagnostics.

`@gang-of-beads/pi-web-plugin-api` remains unpublished; package loading
is exercised through a locally packed tarball, which is enough to prove
the loader but not the publish path.

## Package loading on the live stack, 2026-09-05

The package clause is now proven at every layer that does not need the
registry:

- **The contract ships as a package.** `packages/pi-web-plugin-api` carries
  the same declarations the repository builds and baseline-tests, published
  by a tag-scoped workflow (`plugin-api-v*`) so a contract release never
  re-runs the main release machinery. First publish of a new package cannot
  use trusted publishing, so the workflow keeps the bootstrap-token route.
- **A split repository ships an installable plugin.** `pi-web-themes` now
  declares its plugin in the `piWeb` manifest, commits its bundled browser
  module (a git install runs no build), and publishes through its own
  workflow with a freshness gate.
- **pi-web loaded it live.** On the 8505 stack, with the bundled themes
  directory removed so a pass could not come from the checkout, the manifest
  served themes with `source: git:https://github.com/Gang-of-Beads/
  pi-web-themes.git` and `scope: project`, installed through pi's own
  package manager. The browser executed the package's module and the theme
  registry held all eight packs from it, the active preference resolved
  through the package copy.

Still blocked on the owner, both outside this session's authority:

1. **First publish bootstrap.** npm requires a package to exist before
   trusted publishing can be configured; the workflows accept an
   `NPM_TOKEN` secret for that first push, and the token is the owner's to
   provide.
2. **model catalog.** The objective's extraction list names it; matching pi
   argues for keeping it in core. The objective must be amended or the
   catalog extracted.

## Split repository coverage and the review wave, 2026-09-05 (later)

A follow-up audit noted that not every plugin had the private repository
the objective promised. `Gang-of-Beads/pi-web-goals` now exists, split from
`pi-web-plugins/goals` with its real history, packaged like the themes pack
(bundled browser and server modules committed, `piWeb` manifest, the same
tag-gated publish workflow). The plugin-api contract deliberately lives as
a subpackage of this repository rather than its own repository: its history
is this repository's history, and a separate clone would have to track it.

The three-lane review of the goals and publishing wave found the first
extraction pass unclosed and its fixes are in: the panel's controls wired
through two new general seams (`requestUpdate`, optional `runCommand`),
honest empty states, the focused session's cwd back in the read, and core's
orphaned goals machinery removed. Recorded in
`review-triage-goals-package-wave.md`.

## Owner rulings, 2026-09-05 (final)

The three open items were put to the owner and answered:

1. **model catalog: the objective is amended, not the catalog extracted.**
   The owner formalized the earlier in-conversation ruling: model selection
   and the model catalog stay in core, matching pi, where `/model` and
   Ctrl+P are core commands and extensions only observe `model_select`. The
   objective's extraction list is amended accordingly; this is the owner's
   amendment of the contract, recorded here as such.
2. **First npm publish: deferred.** The three publish-ready packages and
   their workflows stay as they are; the tarball and git-install proofs
   already recorded stand as the package-loading evidence.
3. **The bundled themes copy is removed.** The owner's answer: when the
   plugin already exists, the bundled copy should go. `pi-web-plugins/themes`
   left this repository; the theme pack's home is
   `Gang-of-Beads/pi-web-themes`, installed as a package. The appearance
   panel's contract is with any theme-contributing plugin, and its tests now
   use a fixture pack instead of the real one.

## Bundled goals removed, 2026-09-05 (later still)

Applying the owner's bundled-copy ruling to goals itself: with
`Gang-of-Beads/pi-web-goals` existing as the plugin's home, the bundled copy
left this repository. The agent directory now installs the goals package
(git), so the feature keeps working in real deployments; the drawer and the
navigation panel draw whatever goals section a contributed plugin provides,
which is the seam the wave built. The same logic will be applied to the
remaining bundled plugins as their split repositories mature.

