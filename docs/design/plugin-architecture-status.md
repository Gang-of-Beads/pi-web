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
