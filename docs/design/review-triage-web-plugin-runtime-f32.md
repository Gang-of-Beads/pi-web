# Review triage — web plugin hosting + per-process reconcile round (2026-09-05)

Three bllm lanes (glm-5.3-flash ×2 split focus, qwen3.8-flash-next full
pass) over the three committed Wave 0 chunks (2345fe38 contract,
12677100 mount, e0d422ec hosting) plus the uncommitted per-process
reconcile diff. Findings deduplicated across lanes; each adjudicated
against source before acting.

## Fixed in this round

- **P1 (all three lanes) — the daemon→web handshake parse dropped `runs`.**
  `parseRuntimeRecord` rebuilt records field-by-field, so the role choice
  in `cachedArtifactIsActive` only engaged when the daemon was
  unreachable. Fixed: optional `runs` parsed against the literal set,
  wire round-trip pinned in `sessionDaemonWorkspaceCatalog.test.ts`
  (valid value forwarded; invalid value rejected as a protocol error).
- **P1 — `cachedArtifactIsActive` preferred the daemon record.** A `both`
  plugin with a fresh web view and a stale daemon view (or a wire record
  without `runs`) judged the cache against the wrong process. Fixed: the
  web view is authoritative whenever it holds the plugin (the web process
  serves the asset); the daemon view is the fallback.
- **P1 — `both` was judged by the web view alone**, breaking the
  "pairs dual entries only with the active compatible snapshot"
  invariant: a fresh web view paired a new browser module with stale
  daemon-side operations. Fixed: `both` merges both views — state is
  `active` only when both are, `staleRevision`/`restartRequired` OR over
  both, `activeRevision` reported from the web view (what the browser
  loads). States enumerated in `piWebPluginLifecycle.test.ts` (both
  fresh / daemon stale / daemon missing / web failed).
- **P2 — web-only orphan records were invisible** in `/api/plugins`
  while their routes kept serving. Fixed: web record keys join
  `pluginIds`; an orphan classifies by its record's `runs` and renders
  `discovered: false` like the daemon path always did.
- **P2 — an injected `deps.serverPluginRuntime` captured no web
  snapshot**, so the service never saw a web view on that seam. Fixed:
  snapshot capture moved out of the assembly branch and covers injected
  runtimes too.
- **P2 — the mount adapter re-implemented request cancellation with
  weaker semantics** (no pre-existing-disconnect check, no dispose).
  Fixed: uses the shared `requestCancellation` helper.
- **P2 — the web provider-runtime parser rejected the
  `withheld-untrusted` diagnostics the daemon legitimately ships**, which
  would render the whole daemon view incompatible for any project with an
  untrusted plugin directory. Fixed: the code is accepted. (General
  tolerance of unknown diagnostic kinds remains open; see deferred.)
- **P2 — the "web-addressed" predicate was spelled three ways.** Fixed:
  one exported classifier (`pluginRunsOnWeb`) used by the catalog filter,
  the lifecycle, and the service.
- **P2 — `serverRuntime.safeStart` doc comment claimed sessiond-only.**
  Fixed: "active in either process; absence means no process is in
  recovery".
- **P2 — test gaps around the new wiring.** Added: service-level test
  with `webRuntimeProvider` (daemon unreachable + web view active → the
  web plugin renders `active` while `serverRuntime.status` stays
  honest; asset cache pins to the web view's revision and reports drift
  as `staleRevision`), the parse round-trip above, the `both` state
  enumeration, the orphan rendering, and a mount-collision diagnostic
  assertion.
- **P2 — changeset coverage.** The per-process reconcile semantics ship
  their own changeset (`process-role-plugin-reconcile.md`).
- **P2 — design doc drift.** `web-plugin-runtime.md` amended: role-keyed
  views are a local merge with the wire unchanged (protocolVersion
  stays 1), `both` requires both views, and the Wave 0 interim behavior
  (daemon activation, mount collisions, body/transport bounds, catalog
  parity) is recorded as decision rather than accident.

## Deferred with reason (owner decisions / later waves)

- **Daemon still activates `runs: "web"` plugins.** Load-bearing today:
  the operations proxy forwards everything to the daemon, so filtering
  the daemon now would 404 web plugins' operations. Resolves with the
  Seam 3 per-plugin operations split (extraction waves).
- **Settings copy names the wrong process for web drift.**
  `SettingsPluginsPanel` says "restart the session daemon" whenever
  `restartRequired`; a per-plugin role field on the API is needed to do
  better. No in-repo plugin declares `runs` yet, so the copy is not
  reachable in practice — product semantics belong to the owner.
- **Unknown diagnostic kinds from the daemon still throw.** Accepting
  them wholesale needs a rendering decision for the unknown; revisit
  with the catalog parity work (F3.1).

## Judged not true

- `AGENTS.md` flagged as bundled into the runtime change: it is the
  owner's local, uncommitted file and was never part of the diff.
