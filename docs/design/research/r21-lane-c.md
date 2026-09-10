# Round 21 — Lane C: cross-file consistency, dead rules, docs-vs-code drift, retirement-model bypasses

Branch `refactor/plugin-architecture`, HEAD `45e7741d` (+ round 20 `6c32b436`). Read-only review; no files touched.

Every item below was adjudicated against the code, not against the changelog. Where a
changeset or code comment makes a claim, the claim is quoted verbatim and then tested.

---

## TRUE findings

### T1 — The gateway's transport relabel escapes the retirement model, so a machine that comes back keeps a red banner (severity: medium-high)

**Where**
- `src/server/web/machines/machineProxyRoutes.ts:365-374` — `sendGatewayError` answers the browser with
  `{ error: "Remote machine unavailable" | "Remote machine timeout", statusCode: 502|504, machineId, detail }`.
  The real evidence (`detail`, e.g. `connect ECONNREFUSED 192.168.1.20:30123`) goes into a **separate field**.
- `src/client/src/api/http.ts:53` + `:61-64` — `errorMessage(body)` reads **only** `body["error"]`. `detail`
  and `machineId` are discarded on every non-2xx response.
- `src/client/src/notice.ts:96` — `if (error instanceof HttpError) return noticeForReader(text);`
  Retirement is decided by whether `isTransientError(text)` matched **first** (line 93).
- `src/client/src/components/errorBanner.ts:50-90` — the wording table has no rule for
  `Remote machine unavailable` or `Remote machine timeout`.

**Failure scenario (minimal)**
A laptop with a registered machine sleeps, or a phone's tunnel blinks, or the remote PI WEB is mid-update.
Any background read routed through the proxy (`api.health(machineId)` → `api/machines/<id>/health`,
`src/client/src/api/clients.ts:122`) gets a 502 from the local web process. The client throws
`HttpError("Remote machine unavailable", 502)`; `noticeFromError` finds no table match and returns
`reader` retirement with scope `"page"`. `errorBanner` skips normalization entirely for reader-retired
text (`errorBanner.ts:23`), so the user sees a **red `role="alert"` bar reading the raw internal label
"Remote machine unavailable"** with no machine named. Thirty seconds later the machine is answering
requests — `reportTransportReachable` fires (`http.ts:50`), `clearTransientError` runs
(`PiWebApp.ts:1042`) and **returns immediately** because `errorRetiredBy !== RetiredBy.reply`
(`PiWebApp.ts:1043`). `scheduleTransientErrorDismissal` also declines (`PiWebApp.ts:1075`). The only exit
is the dismiss button.

**Why this is drift, not design**: `notice.ts:84-88` states the intended rule in prose —
*"The exception is a proxy failure whose body is a transport claim - the gateway answered, but only to say
the daemon behind it is unreachable, which is the commonest banner an update produces. That claim heals, so
it keeps reply retirement and the wording table applies."* The table never learned the gateway's own two
labels, and the field that carries the classifiable evidence is dropped at `http.ts:53`. The promise holds
only for the *local* daemon (whose 502 body is forwarded verbatim and matches rule 1 at
`errorBanner.ts:60`), so the same failure heals on the local machine and never heals on a remote one.

**Cross-file corroboration**: two settings helpers already classify these exact strings as recoverable
transport facts and name the machine — `src/client/src/components/settings/settingsMachineTarget.ts:50-55`
and `src/client/src/components/settings/piPackageSettings.ts:85-90`
(`"Could not reach ${target.name} … Check the machine connection and try again."`). Those are the only two
recognizers of the gateway vocabulary in the client. Same sentence, two lifetimes and two wordings
depending on which component happens to render it.

**Fix shape (any one)**: add the two labels to the transient table *and* make `noticeFromError` scope a
gateway body by its `machineId`; or have `sendGatewayError` fold `detail` into `error` so the existing rule
1 matches; or have `http.ts` surface `detail`.

---

### T2 — Background machine-health failures write an unscoped, unguarded, reader-retired banner onto whichever machine the user is reading (severity: medium)

**Where** `src/client/src/controllers/machineController.ts:124` (and the same shape at `:113`, `:75`, `:88`).

`refreshMachineHealth(machineId)` takes an explicit machine, then its `catch` does
`this.setState(errorNoticePatch(error))` — **no selection guard, no machine scope, no sequence check**.
Its sibling one method down does it correctly: `refreshMachineRuntime` re-checks
`this.runtimeRefreshSeqByMachine.get(machineId) === seq` before writing (`machineController.ts:138`), and
the fan-out variant `refreshMachineHealthFor` (`:177-181`) swallows rejections via `Promise.allSettled` and
raises nothing at all. The single-machine variant is the odd one out.

**Failure scenario (minimal, and it is already wired)**: `PiWebApp.ts:1498` calls
`await this.machines.refreshMachineHealth(machineId)` for a **remote** machine as step 1 of the
route-restore ladder. Deep-link to machine B, which is down. `api.health("B")` rejects with the T1 banner
(`HttpError`, reader-retired, scope `"page"`). The user, seeing nothing happen, taps machine A while that
request is in flight. Control returns to `PiWebApp.ts:1499`:
`if (!this.pendingRemoteRouteRestoreStillCurrent(route)) return;` — the ladder **abandons without
replacing the message it never owned**. The user is now looking at machine A under a red
`"Remote machine unavailable"` alert about machine B, with no machine named, and by T1 nothing can retire
it but a click.

Note the guard the caller owns is checked *after* the write; only the callee could have scoped the claim,
and it does not. This is the exact bypass class the round-20 scope model was built to close: the claim
reaches the banner without ever carrying the machine it speaks about (`errorNoticePatch` defaults
`errorMachineId` to `"page"`, `errorNotice.ts:28`).

---

### T3 — `CORE_STATUS_FLAGS` exists twice as two independent literals; the changeset's "renaming a flag breaks the build" claim is false (severity: medium)

**Where**
- `src/shared/machineStatus.ts:56-64` — the wire contract. Consumed by the **producer**
  (`src/server/daemon/status/machineStatusService.ts:184-188`) and by the core renderer
  (`src/client/src/components/activityBadge.ts:1`).
- `src/plugin-api.ts:46-51` — a second, hand-copied literal with the same three values
  (`core:working`, `core:terminal`, `core:unread`). Consumed only by
  `pi-web-plugins/machines/browser/activityBadge.ts:2,20-28` and
  `pi-web-plugins/workspaces/browser/activityBadge.ts:2,20-28`.

`.changeset/round-twenty-scope.md` claims: *"the status flag wire contract is exported from the plugin API
so renaming a flag breaks the build instead of blanking every work mark."*

**Falsification**: the export is a copy, not a reference. Rename `"core:working"` in
`src/shared/machineStatus.ts` (the file that actually defines what goes on the wire). The daemon publishes
the new id; `src/client` follows; the plugins keep reading `flags["core:working"]`. `StatusFlags` is
`Readonly<Record<string, boolean>>` (`src/shared/machineStatus.ts:25`), so an unknown key is
`undefined`, not a type error — `statusActivityKind` falls through to `undefined`
(`pi-web-plugins/machines/browser/activityBadge.ts:20-24`) and every machine and workspace row loses its
work/terminal/unread mark. **The build is clean.** No test links the two definitions: the only tests that
mention the constant, `src/shared/machineStatus.test.ts:2` and
`src/server/daemon/status/machineStatusService.test.ts:3`, both import from `./machineStatus`.
`docs/plugins.md` does not mention `CORE_STATUS_FLAGS` at all.

Same shape, third copy: the `statusActivityKind`/`hasUnreadStatus` bodies are near-verbatim in
`src/client/src/components/activityBadge.ts` and both plugin files — three copies of the arbiter's input
rule with nothing enforcing agreement.

---

### T4 — The plugin API exports a runtime value through a types-only export condition, and `docs/plugins.md` still promises there is no runtime export (severity: medium)

**Where**
- `package.json:11-18` — `"./plugin-api": { "types": "./dist/plugin-api.d.ts" }`. No `"import"`/`"default"`
  condition. Compare the sibling `"./server-plugin-api"` in the same block, which **does** carry
  `"import": "./dist/server-plugin-api.js"`.
- `packages/pi-web-plugin-api/package.json` — same types-only shape, so the stance is deliberate in both manifests.
- `src/plugin-api.ts:46` — `CORE_STATUS_FLAGS` is a **value**, added by round 20.
- `docs/plugins.md:663` — *"The only supported plugin type entrypoints are the type-only package exports of
  `@gang-of-beads/pi-web/plugin-api`… Use them with `import type`; there is no runtime JavaScript export."*
- `scripts/plugin-api-package-smoke.mjs` — resolves the entry with `ts.resolveModuleName` + `createProgram({ noEmit })`,
  i.e. it proves **type** resolution only, and its fixture `test-fixtures/plugin-api-consumers/browser.ts:1`
  uses `import type`. Nothing imports the value. The name overstates the coverage.

**Failure scenario (external author)**: a third-party plugin does `import { CORE_STATUS_FLAGS } from
"@gang-of-beads/pi-web/plugin-api"` — the shape the new export invites, and the shape the in-repo plugins
now use. `tsc` passes (the `types` condition resolves). At runtime Node throws
`ERR_PACKAGE_PATH_NOT_EXPORTED` — verified empirically against the built package.
`dist/plugin-api.js` **is** emitted (`tsc -p tsconfig.build.json`) and **is** shipped (`files: ["dist"]`);
only the exports map blocks it. One missing line, `"import": "./dist/plugin-api.js"`.

**In-repo status: latent, not broken.** Browser plugins are served as raw files from
`/pi-web-plugins/:pluginId/*` (`src/server/web/app.ts:227`) and loaded with
`import(/* @vite-ignore */ moduleUrl)` (`src/client/src/plugins/external.ts:77`), with no import map
anywhere in the project. Bare specifiers survive only when `scripts/build-plugins.mjs` bundles the entry,
and `needsBundling()` (`scripts/build-plugins.mjs:77-86`) decides by testing the **entry file's own**
import lines with `/(?:^|\n)\s*import\s[^;]*from\s+"(?!\.)/u`. Today both plugin entries import `"lit"`
directly, so they bundle and esbuild resolves the `@gang-of-beads/pi-web/plugin-api` value through
`tsconfig.json` paths. Delete that one `lit` import from an entry and `needsBundling` returns false, the
per-file output is served verbatim, and `activityBadge.js:3` still says
`import { CORE_STATUS_FLAGS } from "@gang-of-beads/pi-web/plugin-api"` → *Failed to resolve module
specifier* → the plugin never registers. Transitive bare imports are invisible to the guard, and the
transitive graph is precisely where round 20 put the new value import.

---

### T5 — Three normalization rules are unanchored and erase the machine's name from composed transport messages, violating the invariant their own comment states (severity: low-medium)

**Where** `src/client/src/components/errorBanner.ts:84-86` states the rule for the fetch family:
*"The match is anchored to the whole message: this family's phrases also appear as the detail of a composed
message ("X is unavailable; reconnecting… Failed to fetch"), and rewriting that would erase the machine's
name."* Rule 5 (`:87`) obeys. Rules at `:60`, `:67`, `:70` do not.

The composed message is real: `PiWebApp.ts:1535-1546` builds
`` `${machineName} is unavailable; reconnecting… ${detail}` `` (and the exhausted variant
`` `${machineName} is still unavailable. ${detail}` ``), where `detail` is the machine's own last health
error. Verified by evaluating the exported patterns against those inputs:

| composed input | rendered banner | machine named? |
|---|---|---|
| `Dev-Box is unavailable; reconnecting… Session daemon unavailable: connect ECONNREFUSED /home/u/.pi-web/sessiond.sock` | `Reconnecting to the session daemon…` | **no** (rule `:60`) |
| `Dev-Box is unavailable; reconnecting… Operation was aborted` | `Previous request was interrupted. Retry if the message did not finish.` | **no** (rule `:67`) |
| `Dev-Box is unavailable; reconnecting… Remote machine request cancelled` | `Connection changed while the request was in flight. Retrying is usually enough.` | **no** (rule `:70`) |
| `Dev-Box is unavailable; reconnecting… Failed to fetch` | `Dev-Box is unavailable; reconnecting… Failed to fetch` | yes (rule `:87` anchored) |

**Failure scenario**: a user with two or more machines unreachable at once (a home machine and an office
machine are the documented fleet case) sees the same amber bar for both, reading
"Reconnecting to the session daemon…", with no way to tell which one is down — while the sibling variant of
the *same* message, differing only in what the detail happened to say, does name it. The whole point of the
round-20 scope work ("recovery is now vouched for per machine", `.changeset/banner-retirement-model.md`) is
that transport claims identify their machine; the wording table silently un-says that for 3 of the 5
reachable detail strings.

---

### T6 — `noticeFromError`'s `link.live` seam has zero producers; the deadline-hiding behaviour it documents cannot happen (severity: low, dead code)

**Where** `src/client/src/notice.ts:79-80`:
`export function noticeFromError(error, link = { live: false })` / `if (error instanceof RequestTimeoutError && link.live) return NO_NOTICE;`
and the doc comment at `:69-78`: *"A deadline miss therefore raises nothing here while the socket is proven
live; only a link that cannot be shown alive still speaks for the page."*

**Proof of no producers**: every non-test call site of `noticeFromError(` (reached through
`errorNotice.ts:25`, whose own default is `{ live: false }`) passes a single argument. Repo-wide, the only
occurrences of `live:` are the two default-parameter literals in `notice.ts:79` and `errorNotice.ts:25`.
And `src/client/src/api/transportHealth.ts` exposes no liveness query at all — only
`observeTransportRecovery` (`:22`) and `reportTransportReachable` (`:42`) — so there is nothing a caller
*could* pass. The model was built reactive (a success withdraws a banner) while the doc still describes it
as proactive (check liveness before raising).

**Failure scenario**: a session-scoped POST misses its deadline while the realtime socket is demonstrably
answering — the exact case the comment calls out. The designed behaviour is silence; the actual behaviour is
a page banner, `noticeFromTransport(text, machineIdFromUrl(error.url))` (`notice.ts:100`), which sits for
`TRANSIENT_ERROR_TIMEOUT_MS` = 6s (`errorBanner.ts:48`) over a transcript that is still streaming. The
behaviour the seam would provide is claimed nowhere else — `timeout-banner-self-retires.md` describes only
the as-built model (retire on the next successful exchange, expire on the timer) — so the unreachable branch
survives review carrying a promise no caller can keep.

---

### T7 — Stale sentinel comments: the unscoped scope is `"page"`, two comments still say `"local"` (severity: low, docs-vs-code drift)

**Where**
- `src/client/src/notice.ts:26` — `/** The machine a transport claim is about; "local" when the claim is global. */`
- `src/client/src/components/PiWebApp.ts:1039` — *"a page-level ("local") claim is disproved by any success at all."*
  The very next lines compare against `"page"` (`PiWebApp.ts:1046-1048`).

**Proof**: the sentinel string is produced only in `errorNotice.ts:28,33,38` as `"page"`, and consumed only
as `"page"` at `PiWebApp.ts:1047`. `grep '"local"'` over the scope model returns only these two comments
(all other `"local"` hits are the genuine machine id `local`, which is a different thing — the machine named
`local`, not the unscoped sentinel — which is exactly why the stale comment misleads).

**Failure scenario**: a maintainer adding a second scope kind follows `notice.ts:26` and compares
`errorMachineId === "local"` for a page-level claim; it never matches, and page-level claims silently stop
being withdrawn. There is no constant and no type narrowing the sentinel, so nothing catches it.

---

### T8 — Four bare `error: ""` writes survive the claim that the last one was converted (severity: low, latent invariant break)

`.changeset/round-twenty-scope.md`: *"the last bare error writes … go through the seam."*

**Remaining writers of the text without its retirement pair**
- `src/client/src/appState.ts:191` — `resetWorkspaceScopedState()` returns `error: ""` with no
  `errorRetiredBy`/`errorMachineId`.
- `src/client/src/controllers/sessionController.ts:544` (queued pending send), `:1623` (session selected
  without a read), `:1664` (pending session replaced by the real one).

**Why TypeScript cannot help**: `WorkspaceScopedStateReset` (`src/client/src/appState.ts:165-174`) is
`Pick<AppState, … | "error">` and deliberately omits `errorRetiredBy` and `errorMachineId`. A `Pick` that
excludes fields cannot make a missing field an error. Contrast `initialAppState()` (`appState.ts:269`), which
sets all three together.

**State today**: after any of these writes, `error === ""` while `errorRetiredBy` and `errorMachineId` still
describe a message that no longer exists. Both readers defend (`clearTransientError` early-returns on empty
text, `PiWebApp.ts:1043`; `scheduleTransientErrorDismissal` is only reached with non-empty text,
`PiWebApp.ts:3815`), so **no symptom is observable yet** — the failure is that the invariant the changeset
declares does not hold, and the type the round-20 note credits with enforcing it
("a call site added later cannot reintroduce either half") structurally cannot. Any future rule that acts
on scope without re-reading the text — e.g. "clear only claims scoped to the current machine" — will act on
a stranger's scope.

(Excluded false positive: `PiWebApp.ts:2185`'s `error: ""` is a field of the session-cleanup dialog object, not `AppState`.)

---

### T9 — The rail's `sending` entry is dead: no `.action-row` can ever wear that class (severity: low, dead rule + contradicted changeset claim)

`.changeset/round-twenty-scope.md`: *"the unread ring's rail entry and a sending entry align the rail table
with the dots it follows."*

**Where** `src/client/src/components/shared.ts:454` —
`.action-row:has(:where(.activity-indicator.sending)) { border-left-color: var(--pi-warning); }`

**Proof of deadness**
1. The only producer of `class="activity-indicator sending"` in the entire client is
   `src/client/src/components/SessionList.ts:318`, inside
   `<div class="pending-session-row starting-session">` (`SessionList.ts:316`) — styled separately at
   `SessionList.ts:738-741`, and **not** an `.action-row`. `:has()` cannot reach an ancestor's ancestor.
2. The arbiter never emits it: `sessionRowIndicator.ts:53` maps `stateKind === "sending"` to
   `kind: "running"`, so `.session-state.sending` does not exist either (and `shared.ts:454` does not list
   that vocabulary anyway).
3. The row helper can't emit it: `statusActivityKind` returns `"session" | "terminal" | undefined`
   (`src/client/src/components/activityBadge.ts:17-22`, and identically in both plugin copies).

So `shared.ts:454` is unreachable. (`shared.ts:465`, the dot paint, **is** live — it paints the pending
session row — but its comment is also wrong: `:464` says "Client-side sending (upload in flight)", while the
only thing that ever draws it is *session creation*.)

**Failure scenario**: someone adds a real client-side upload indicator to a session row wearing
`.activity-indicator.sending`. The rail stays transparent for it — the amber they aligned to the dot palette
is on a selector the row can't satisfy — and the guard suite passes, because the CSS guards check tokens and
specificity, never reachability. Cheapest repair is to fold `sending` into an entry that can match, or delete
454 and the changeset's claim about it.

---

### T10 — `pointerQueryOrder.test.ts` cannot see most of the CSS it is supposed to police (severity: low, latent guard gap)

**Where** `src/client/src/components/pointerQueryOrder.test.ts`.

Two mechanisms, both confirmed by running the guard's own regexes against crafted inputs:
1. The order check uses `(?:^|\})` **without the `m` flag**, so the *first* rule inside every
   `(pointer: …)` / `:hover` block — the one preceded by `{` rather than `}` — is never examined.
   119 pointer/hover media blocks across `src/client/src` are exposed to this blind spot.
2. Pairing is by **exact selector string**. A rule that adds a compound selector
   (`.x` → `.x:focus`), or a grouped selector inside the block, or the same declaration in a *later*
   grouped rule, silently escapes.

**Live impact today: none.** A near-miss sweep found 12 candidate pairs; every one differs only by
`:focus`/state classes or does not re-declare a raised property, so all are benign. The finding is that the
guard's green tick is weaker than its name implies: the regression it exists to catch (a coarse-pointer rule
placed before the base rule and overriding it) is invisible to it whenever the override is written as a
compound or grouped selector.

---

## FALSE adjudications (investigated, no defect)

| # | Hypothesis | Verdict | Why |
|---|---|---|---|
| F1 | `.session-state.running` appears in two rail rules (`shared.ts:455-456`) — duplicate/dead | **FALSE** | Intentional composite precedence: `:455` paints success for `.activity-indicator.session` (machines/workspaces) **and** `.session-state.running`; `:456` re-paints *session* rows to `--pi-accent` because that vocabulary's running dot is blue (that vocabulary has no `.session-state.running` colour rule; the mark takes `--pi-accent` from the generic `.state-dot` rule at `sessionStateBadgeStyles.ts:38`). Both rules are `(0,1,0)`, so later-wins is the documented tiebreak (`shared.ts:446-452`), and `sessionRowIndicator.ts:69` confirms `.session-state.running` really renders. |
| F2 | `.unread-ring` rail entry is dead (no such element) | **FALSE** | The ring is emitted for unread-and-working machine/workspace rows; `shared.ts:446-450` explains why the ring is deliberately *not* in the rail table (the wrapped dot decides the colour). Reachable and correct. |
| F3 | `reportTransportReachable` is only called from the REST path, so socket/SSE-only recovery never withdraws a banner | **FALSE** | `http.ts:50` is the only producer, but the `piWebStatusTimer` REST polls run unconditionally — visibility changes do not pause them — so any machine that has ever answered re-enters the seam within one poll. `observeTransportRecovery` is registered for the app's whole lifetime (`PiWebApp.ts:1084` deregisters on disconnect only). |
| F4 | Recovered gateway errors can strand `interruptedRunsUnknown` across machines (it is one boolean, not per-machine) | **FALSE** | The flag's writers are gated by the machine guard in `refreshInterruptedRuns`, and the announcement it drives is suppressed for a non-selected machine. Worst case is a hidden-state no-op, not a wrong banner. |
| F5 | Removing the machines-plugin `MachineSwitcher` left code/behaviour residue | **FALSE** | Repo-wide grep: `MachineSwitcher` survives only in prose (changesets, `docs/design/*`). No import, no style, no slot, no test, no dead CSS class. The machines plugin now renders `machine-list` through its own Lit template, so nothing still expects the switcher's DOM. |
| F6 | Rail `:has()` cannot match across shadow boundaries (plugin marks live in a different component) | **FALSE** | In every affected list, the row and its mark are template siblings in the **same** shadow root, which is exactly the case `:has()` is defined to match. Separately: `PiWebApp` does not adopt `listStyles` at all (`PiWebApp.ts:3973` adopts `interactiveSurfaceStyles`, `sessionStateBadgeStyles`, `appStyles`), so the hypothesized cross-file override never exists. |
| F7 | A "nav-rail" CSS class is referenced by rules that no component emits | **FALSE (misattribution)** | `grep nav-rail src/client/src` → zero hits. The rules in question are `.action-row:has(...)` (`shared.ts:453-459`); the surrounding comments call it "the state rail" in prose, never as a selector. Only the real dead entry is T9's. |
| F8 | `onBackgroundError` swallows errors that should reach the banner, bypassing retirement | **FALSE** | `PiWebApp.ts:299-301` logs only. Those are background reads whose owners already handled their own failure; treating them as page claims is what produced the 1.5 s red-flash bug the retirement model removed. Correct as written. |
| F9 | Plugin bundling is already broken — bare specifiers reach the browser today | **FALSE (live), TRUE (latent)** | Re-running `needsBundling`'s exact regex plus a transitive graph walk over every emitted entry: all bare specifiers are resolved, and `dist/pi-web-plugins/machines/browser/pi-web-plugin.js` opens with esbuild's bundle header. The fragility is the *guard*, not the current output — see T4. |
| F10 | `machine-list[collapsed]` cannot match because `collapsed` is a property, not an attribute | **FALSE** | `@property({ type: Boolean, reflect: true }) collapsed` — the reflect flag keeps the content attribute in sync, which is all the selector needs. |
| F11 | `/api/machines` (the roster poll) is machine-scoped, so it wrongly withdraws daemon-down banners | **FALSE** | `machineIdFromUrl` (`transportHealth.ts:31`) needs `/machines/<segment>`; the bare roster URL yields `undefined`, i.e. a web-owned success that vouches for nothing. Exactly what the round-20 note intends. (The genuine cross-machine writer is T2, a different call.) |

---

## Method notes

- Producer sweeps were done on `noticeFromError(`, `errorNoticePatch(`, `noticePatch(`, `clearErrorPatch(`,
  `error: ""`, `CORE_STATUS_FLAGS`, `activity-indicator`, `Remote machine (unavailable|timeout)` across
  `src/`, `pi-web-plugins/`, `packages/`, `scripts/` (tests excluded, then read separately to confirm intent).
- Message-table behaviour (T5) was checked by evaluating the exported regexes in Node against the composed
  strings that `PiWebApp.ts:1546` actually builds, not by reading the table.
- Package resolution (T4) was checked against a real `tsc -p tsconfig.build.json` output tree and a real
  `import()` of the subpath.
- Dead-CSS claims (T9) require a producer sweep over both vocabularies (`.activity-indicator.*` and
  `.session-state.*`) in core **and** both plugins; checking core alone produces two false positives (F1, F2)
  and one miss.
