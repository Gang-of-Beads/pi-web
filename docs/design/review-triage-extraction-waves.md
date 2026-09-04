# Review triage: extraction waves

Four read-only lanes (two glm max with split focus, one qwen max full pass, one
red team) over the voice, operations, terminal, contract, themes and trust-gate
commits. Every finding is adjudicated below.

## Fixed

- **The shipped theme pack could never load** (red team P0). `themes` was a
  reserved plugin id, reserved precisely because the pack used to be app code
  registered under that name. Once the pack shipped as a plugin, the guard
  refused it: no themes in the picker and no theme applied at all. The name is
  freed and stays spelled the same, so a saved preference like
  `themes:clay-paper` still resolves.
- **The terminal plugin could not be loaded by a browser** (qwen P0-A). Browser
  plugin modules are served raw with no import map and no bundler, and the
  terminal entry's graph reaches `lit` and `@xterm/*` - the only bundled plugin
  that imports a package at runtime, because every other one draws through the
  host's `html` tag. The build now bundles an entry whose graph reaches a
  package and leaves package-local entries as readable per-file output. A new
  test builds the plugins and fails on any unresolvable specifier in a shipped
  entry, so this cannot return silently.
- **Voice asked for a route that no longer exists** (glm-boundary F1).
  `api/speech/token` moved into the plugin's `speech.token` operation, but the
  browser half still called the old path, which the SPA fallback answers with
  HTML - dictation would fail with a parse error. It now calls its own
  operation under its runtime plugin id, so a machine-scoped copy asks its own
  machine, and an unconfigured install is reported as unconfigured rather than
  as a malformed answer.

## Not fixed, with reason

- **Client abort does not reach a plugin operation** (glm-trust P1, true). The
  web proxy forwards without a signal, so a closed tab leaves the operation
  running. Real, and worth fixing with the repo's existing
  `requestCancellation` helper rather than the hand-rolled listener now in the
  daemon route. Deferred to its own change because it touches the shared
  sessiond client's cancellation path, which the backend proxy also uses; doing
  it inside this triage would mix two concerns in one commit.
- **The trust gate has no production caller yet** (qwen P2-D, true). The
  classifier, the catalog wiring and the diagnostics exist and are tested end
  to end against a real directory, but nothing yet passes a workspace's trust
  state in. That producer belongs with the workspace surface that knows which
  project is open, and is the next task in this wave.

## Judged not true

- Project-local plugin shadowing a bundled id, module paths escaping the
  package root, symlinked escapes, prototype reach through operation names,
  storage keys escaping their directory: all refused, each with the file and
  test cited by the lanes.
- Process ownership: web does not import daemon, and both halves of the
  operation boundary reach each other only through the shared sessiond client.
- The pty capability genuinely stayed in core, as the owner ruled; the plugin
  draws a panel and consumes a capability whose scope the host binds once.
