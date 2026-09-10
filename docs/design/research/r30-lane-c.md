# Round 30 — Lane C: cross-file consistency, leftovers, docs-vs-code drift

Branch `refactor/plugin-architecture`, HEAD `c4b23328` (round-29 fix commit; parent `5d09ff61`).
Read-only pass. Every finding carries file:line, a concrete failure scenario, and a verdict.
Round-30 focus: seams **newly opened by `c4b23328` itself**, plus the three sweep items
(MachineSwitcher leftovers, docs drift, unconverted banner producers).

## Verdict table

| # | Finding | Where | Verdict | Severity |
|---|---|---|---|---|
| F1 | `state.error !== ""` is used as "did the load fail", and r29 made that signal meaningless | PiWebApp.ts:1560 vs projectController.ts:39 | **TRUE** | High |
| F2 | r29's "local routes stop borrowing the machine wording" fix covers only the first call | PiWebApp.ts:1514 vs 1578/1582/1596 | **TRUE** | Medium |
| F3 | Reader-retired claims lose their machine scope, so `deleteMachine`'s retirement hook can't reach them | notice.ts:37,101 vs machineController.ts:107 | **TRUE** | Medium |
| F4 | Interrupted-runs banner became un-retractable across a machine switch (two r29 halves interact) | PiWebApp.ts:793-795, 815 | **TRUE** | Medium-low |
| F5 | "Local reply-retired banners can never be disproved" — checked and cleared | clients.ts:77,196 | **FALSE** | — |
| F6 | `errorBanner.ts` new comment contradicts the sentence directly below it (+ `fourth..`) | errorBanner.ts:62-66 | **TRUE** | Low |
| F7 | Docs/changeset drift introduced by the r29 doc pass itself | capability-map-draft.md:80,247,243,231; changeset | **TRUE** | Low |
| F8 | New sibling-style test guard degenerates on Windows — and Windows is in the CI matrix | designTokens.test.ts:118-119; ci.yml:24 | **TRUE** | Low |
| F9 | Rail CSS ↔ indicator producers, `.bulk-selected`, MachineList host styles, MachineSwitcher leftovers | shared.ts:409-458 et al. | **FALSE** | — |
| F10 | `machineCount() < 2` gate / dead `collapsible: false` toggle path | ContextSwitcherSheet.ts:54, AppNavigationPanel.ts | **TRUE (repeat of r29)** | Low |
| F11 | `errorBanner` header comment omits the voucher retirement path | errorBanner.ts:5-8 | **TRUE** | Low |

---

## F1 — TRUE (high). The retry ladder's load-success probe was made unreliable by r29

`c4b23328` removed the banner clear from the start of `loadProjects`:

```
projectController.ts:35-39   // No clear here: a load start is not a retirement event …
                             this.setState({ projectsLoad: "loading" });
```

That is a defensible owner decision. But three call sites read `state.error` as a
**fact about the current load**, and the only thing that made those probes sound was
exactly this clear:

```
PiWebApp.ts:1559   await this.projects.loadProjects();
PiWebApp.ts:1560   if (this.state.error !== "") {          // "the listing failed"
PiWebApp.ts:1561     this.scheduleNextRemoteRouteRestoreAttempt(route);
```

Its sibling ladder, twelve lines up, uses the honest signal:

```
PiWebApp.ts:1467   await this.machines.loadMachines(route.machineId);
PiWebApp.ts:1468   if (this.state.machinesLoad !== "loaded") { … }   // ← correct shape
```

So the two restore ladders now disagree about what "the load failed" means, and only
one of them is still true.

**Failure scenario A (an offline machine anywhere in the fleet — no stale banner
needed).** Two remote machines are registered; A is down. At boot
`selectInitialMachine` raises `"<A> is unavailable; reconnecting…"` — reply-retired and
**scoped to A** (machineController.ts:189-196). The reader then opens a deep link to
machine B: `selectMachine` does not clear the banner (machineController.ts:41-62), and
A's claim is never disproved while A stays down, because `clearTransientError` only
accepts a voucher from `"page"` or from the same machine (PiWebApp.ts:1064-1075). So
from that moment on `state.error` is permanently non-empty, and **every** remote-route
restore ladder is dead: B's health is ok, `loadProjects()` **succeeds**, line 1560 reads
the leftover A sentence as "the listing still fails", the ladder burns
`REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS` and ends at
`setRemoteRouteRestoreMessage(route, { exhausted: true })` (PiWebApp.ts:1578) with
**"<B> is still unavailable."** — naming a machine that answered every probe — while
`restoreRouteFor(route, …)` (PiWebApp.ts:1565) is never reached and the deep link is
lost. (The fleet-wide background poll `refreshMachineHealthFor`,
machineController.ts:218-222, drops rejections silently and is *not* the source; the
claim comes from a per-machine `refreshMachineHealth` / `refreshMachineRuntime` failure,
machineController.ts:155 and :179.)

**Failure scenario B (reader-retired claim — no voucher can ever help).** Reader
clicks machine A; its runtime read answers HTTP 500. `noticeFromError` classifies a
non-transient `HttpError` as reader-retired via `noticeForReader(text)`
(notice.ts:101, 37) and **drops `error.machineId`** → the banner sits on screen as a
page-scoped reader claim. Reader then reloads a local project deep link: the local
ladder's `loadProjects()` succeeds, `state.error` is still "Internal Server Error",
the ladder spins to exhaustion and paints "Local is still unavailable." on a
perfectly healthy web process. Pre-r29 the clear at load start made this probe sound.

Same root cause, second site:

## F2 — TRUE (medium). Local routes still get the machine wording, from attempt 2 on

r29 added the guard, and a comment explaining it:

```
PiWebApp.ts:1510-1514   // The reconnecting sentence names a machine; a local route's
                        // ladder retries the projects listing … the machine wording
                        // would promise a reconnect the local ladder never performs.
                        if ((route.machineId ?? "local") !== "local") this.setRemoteRouteRestoreMessage(route);
```

`setRemoteRouteRestoreMessage` itself has **no local guard** (PiWebApp.ts:1586-1597), and
every later call is unguarded:

```
PiWebApp.ts:1578   this.setRemoteRouteRestoreMessage(route, { exhausted: true });
PiWebApp.ts:1582   this.setRemoteRouteRestoreMessage(route);
```

Reachable: `PiWebApp.ts:1214` defers for a **local** route whenever
`projectId !== undefined && projectsLoad === "failed"`, and
`shouldDeferRemoteRouteRestore` returns false for local (line 1440), so the `:1214`
ladder is the local path. Attempt 1 → `setRemoteRouteRestoreMessage` →
`"<local machine's name> is unavailable; reconnecting…"`; exhaustion →
"`<name>` is still unavailable." The changeset's claim "no longer borrows the machine
wording … from a machine that was never probed" is true only for the first message.

Impact is worse than wording: the composed sentence matches
`/is unavailable; reconnecting/i` (errorBanner.ts:67), so `normalizeTransientError`
returns `undefined`, which means the banner is rendered as a **full-red `role="alert"`
"broken forever" bar** rather than the quiet transient row (errorBanner.ts:22-27) — the
exact treatment the transient comment at the top of that file says a self-healing
message must not get. `detail` also comes from `state.machineStatuses["local"]?.error`,
i.e. a possibly stale health error pasted under a claim about the *projects listing*.

## F3 — TRUE (medium). Scope attribution is dropped exactly where retirement needs it

`errorNoticePatch` stamps `errorMachineId: notice.machineId ?? "page"`
(errorNotice.ts:26-30), and `deleteMachine` relies on that stamp to retire a claim whose
machine has ceased to exist:

```
machineController.ts:104-107   // The claim about this machine can never be disproved now …
                               if (this.getState().errorMachineId === machine.id) this.setState(clearErrorPatch());
```

But `noticeFromError` keeps `error.machineId` **only on the transport branch**:

```
notice.ts:100-102   if (error instanceof HttpError)
                      return isTransientError(text) ? noticeFromTransport(text, error.machineId)
                                                    : noticeForReader(text);   // machineId dropped
notice.ts:37-39     export function noticeForReader(text) { return { text, retiredBy: reader }; }  // no machineId
```

**Failure scenario.** Machine B's daemon returns a 500 on an archive; the banner reads
"Failed to archive …", reader-retired, `errorMachineId === "page"` even though
`HttpError.machineId === "B"` (http.ts:59 fills it from the URL). Reader removes
machine B. The claim about B survives B's deletion on screen indefinitely — the very
case the comment at machineController.ts:104-106 says it handles — because the identity
test can never match. Combined with r29 (banners now survive scope switches;
`selectMachine` never clears, machineController.ts:41-62), an unattributed
B-shaped failure is also displayed on machine A's screen with nothing in the banner
naming B. The retirement model has one machine-scoped lifetime (reply) and one
unscoped (reader); every machine-specific *operation* failure falls in the second
bucket by construction.

## F4 — TRUE (medium-low). The interrupted-runs banner can no longer be withdrawn

```
PiWebApp.ts:793-795   if (this.state.error === "") { this.interruptedRunsUnknownMachine = machineId; … }
PiWebApp.ts:815       if (plan.resolveUnknown && this.state.error === INTERRUPTED_RUNS_UNKNOWN_MESSAGE
                          && this.interruptedRunsUnknownMachine === machineId) this.setState(clearErrorPatch());
```

`interruptedRunsUnknownMachine` is written **only inside the guard that the presence of
a banner disables**, and never reset on scope change. Before r29 a machine switch
cleared the banner through `loadProjects`; now it survives (that was the point).

**Failure scenario.** Reader is on A; A's interrupted-runs read fails → banner, marker
= A. Reader switches to B (banner survives, per the r29 decision). B's read fails →
line 793 sees a non-empty banner → the marker stays A, so B's failure is never
attributed. B's next read succeeds and empty → line 815 requires
`interruptedRunsUnknownMachine === "B"` → mismatch → the banner
("Interrupted-run status is unknown: the read failed", PiWebApp.ts:250, which names no
machine) stays on B's screen with no reachable retraction except manual dismissal. The
comment at :810-814 sanctions this ("a success from machine B may not clear machine A's
unknown banner"), but nothing provides the complementary move — the banner asserts
something about a machine the reader is no longer looking at, and the message itself
never says which machine it is talking about.

## F5 — FALSE (cleared). Local machine-scoped claims *are* disprovable

The suspicion that a `errorMachineId === "local"` reply-retired claim can never be
disproved (the restore ladder skips the health probe for a local route, PiWebApp.ts:1542-1556) is wrong:
`machinePrefix` is unconditional — `clients.ts:77` `machinePrefix = (machineId = "local") =>
\`api/machines/${…}\`` and `clients.ts:196` `projects: (machineId = "local") => …` — so every
local call carries `/machines/local/`, `machineIdFromUrl` returns `"local"`, and
`reportTransportReachable` (http.ts:50) disproves a local claim like any other. Only the
three deliberately machine-less local URLs (`api/pi-web/status`, `api/config`,
`api/plugins`, `api/pi-packages` — clients.ts:108,129,133,171) report page scope, which
is correct: they say nothing about a machine.

## F6 — TRUE (low). New comment contradicts the line beneath it

```
errorBanner.ts:62-66   // … Three producers compose the prefix today - machineDownNotice and
                       // the explicit-selection path in the machine controller, and the
                       // restore ladder's retry sentence in PiWebApp - keep that count true
                       // when adding a fourth.. The composed prefix is the
                       // machine controller's own; nothing else produces it.
```

The count is correct (machineController.ts:133 via `machineDownNotice`, machineController.ts:155/179
call sites, machineController.ts:195, PiWebApp.ts:1596 — three production sentences), but the
sentence the edit left running ("the machine controller's own; nothing else produces it")
directly denies the sentence that precedes it, and `fourth..` has a doubled full stop.

## F7 — TRUE (low). Docs drift introduced by the round-29 doc fix itself

* `docs/capability-map-draft.md:80` ��� mangled by the edit: `C:components/GoalPanel.ts (goal list section)4-121,224-241`
  (the replacement ate the head of `104-121`).
* `docs/capability-map-draft.md:247` — the same line the commit edited still lists
  `MachineSwitcher.ts:303,309` (component deleted in `b0bce2a0`, acknowledged in the very
  parenthetical added on that line) and `GoalPanel.ts:227` (`GoalPanel.ts` no longer exists
  anywhere in `src/` or `pi-web-plugins/`).
* `docs/capability-map-draft.md:243` and `:234` still cite `GoalPanel.ts:227` / `GoalPanel.ts:186-196,271-273`
  and `shared.ts:297-299; SessionList.ts:665` — `SessionList.ts:665` is now `closeSelection()`
  logic, not the 30px heading button; the 30px note now lives at `shared.ts:297`.
* `QuickSwitcher.ts:373-374 / :379 / :417-418` (lines 231, 243, 247) — the tile grid is at
  `QuickSwitcher.ts:427` and `:497`; line 373 is `toggleFilter()`.
* `.changeset/round-twentynine-honest-ladder.md`: "it **retriesthe** projects listing itself".
* Verified accurate, for the record: the new `MachineList.ts … currently unreachable —
  every surface passes withCreate:false` claim at `:231` is TRUE — all five machine-context
  call sites pass `withCreate: false` (AppNavigationPanel.ts:275, ContextSwitcherSheet.ts:59,
  PiWebApp.ts:2892, :2960), and `pi-web-plugins/machines/browser/pi-web-plugin.ts:30` gates on it.

MachineSwitcher sweep: zero hits in `src/` and `pi-web-plugins/` source. Remaining mentions
are historical/legit (`docs/design/research/*`, review-triage notes, `designTokens.test.ts:93`
comment, and the two docs items above). `docs/design/phone-navigation-model.md:36`
("`machine-switcher` rendered") is stale prose worth one edit, nothing more.

## F8 — TRUE (low). New test guard silently passes on Windows — and Windows is in CI

```
designTokens.test.ts:118-120
  const sourceDir = defining?.split("/").slice(0, -1).join("/") ?? "";
  const sibling = files.filter((file) => file.startsWith(sourceDir)) … .join("\n");
  const usesSharedListSheet = source.includes("listStyles") || sibling.includes("host.listStyles");
```

`files` are built with `path.join`, so on Windows every entry uses `\`. `split("/")`
then yields a single element, `slice(0, -1)` yields `[]`, and `sourceDir` is `""` —
`startsWith("")` matches **every** walked file. The "a sibling in the same directory
supplies the shared sheet" rule becomes "does any file under `src/client/src` or
`pi-web-plugins` contain `host.listStyles`", which is satisfied by
`pi-web-plugins/*/browser/hostUi.ts:38`. Any hidden-mounted component anywhere in the
tree therefore passes the guard on the Windows job.

`.github/workflows/ci.yml:24` runs `os: [ubuntu-latest, windows-latest]` with
`npm run verify`, so the weakening is live, not latent. It can only cause false passes,
never false failures — hence low. Also, even on POSIX, prefix matching counts nested
subdirectories as siblings, so one `host.listStyles` in `machines/browser/` vouches for
every component beneath it. Fix: compare `dirname(defining)` equality (or `relative()`
segments) instead of a string prefix over a hand-split path.

## F9 — FALSE. Rail / indicator / plugin-style sweep came back clean

* All nine `border-left-color` rules (`shared.ts:409,439,446-450,456-458`) have live
  producers, and precedence is source-order by design (`:where()` inside `:has()`
  contributes 0 specificity, as the comment states). Offline+unread → danger rail wins,
  and `.machine-status::before` paints the matching danger LED, so rail and dot do not
  disagree about state.
* `.session-state.background` sharing the purple of `unread` (shared.ts:439) matches the
  arbiter's priority order in `sessionRowIndicator.ts` and the hollow-ring styling in
  `sessionStateBadgeStyles.ts`. Intentional co-location.
* `.action-row.unread` is produced (SessionList.ts:405) and consumed (SessionList.ts:729);
  absence of a rail rule is the round-18 decision, still documented.
* `.action-row.bulk-selected` uses `border-color` (SessionList.ts:747) rather than
  `border-left-color`, but `.action-row` declares `border: 1px solid var(--pi-border)`,
  so the left edge does change and the "selection owns the left edge" claim holds.
* MachineList **does** receive the rail rules: `MachineList.ts` uses `createRenderRoot()` +
  `adoptMachinesHostStyles(root)` (`hostUi.ts:38` adopts `host.surfaceStyles` +
  `host.listStyles`), i.e. per-instance adoption, not `static styles`. The comment's
  rationale ("static styles freezes at module load") is consistent with `hostUi.ts`.
* `deprecatedAgentInputsBanner` is a separate rendered banner
  (PiWebApp.ts:4001) derived from `machineRuntimes`, never `state.error` — correctly
  outside the retirement model, no self-retirement needed.

## F10 — TRUE (low, repeat of r29). Dead/ divergent navigation paths still open

* `ContextSwitcherSheet.ts:54` hides the whole machines group when `machineCount() < 2`,
  while `AppNavigationPanel` renders the contributed machines section unconditionally.
  Same fleet, two surfaces, different answer. Unchanged by `c4b23328`.
* `collapsible: false` on the machines section (AppNavigationPanel.ts:275,
  ContextSwitcherSheet.ts:59, PiWebApp.ts:2892, :2960) makes the `onToggleMachines` /
  `toggleCollapsed: () => undefined` path unreachable. Dead handler, not a regression.

## F11 — TRUE (low). Banner doc comment predates the retirement model

`errorBanner.ts:5-8`: "It stays until the user dismisses it, another message replaces
it, or the owning action clears it." The model now has a fourth, most-common exit — a
transport voucher retiring it (`PiWebApp.ts:1019 → clearTransientError`, and the
`TRANSIENT_ERROR_TIMEOUT_MS` self-withdrawal at PiWebApp.ts:1121). The second comment
block (lines 16-21) states the rule correctly; the header block still contradicts it.

---

## Producers-not-converted sweep (clean)

`grep` for `setState({ error`, `error: String(`, `error: describeError(` across
`src/client/src` and `pi-web-plugins/*/browser`: the only hits outside `errorNotice.ts`
are non-banner fields — `authController.ts:152,290` (`authDialog.error`),
`machineController.ts:209` (`MachineHealth.error`),
`ProjectDialog.ts:226` / `WorkspaceList.ts:303,316` (dialog-local trust state), and
`SettingsPanelFrame.ts:128` (a variant string). 97 call sites now go through
`errorNoticePatch` / `noticePatch` / `clearErrorPatch`. **No unconverted producer left.**
