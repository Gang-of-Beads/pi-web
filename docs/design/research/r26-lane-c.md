# Round 26 — Lane C: cross-file consistency, dead leftovers, docs-vs-code

Scope: read-only audit of `refactor/plugin-architecture`. Hunted for (1) cross-file
inconsistencies, (2) dead rules/leftovers from the switcher/plugin extraction, (3) docs or
comments claiming what code does not do, (4) producers bypassing the
`noticePatch`/`errorNoticePatch` retirement model.

**Tree note:** my brief said HEAD `3ec25d8d`; during this review HEAD advanced to
`e9d055fd "Start convergence round 26"` (diff touches only `scripts/review-uiux-round26.workflow.js`).
Every finding below was re-verified against the working tree at `e9d055fd`.
Two docs I had read early — `docs/design/session-row-rail.md` and `docs/design/session-row-indicator.md`
— are **gone from the tree and absent from `git ls-files`** (untracked scratch from round 25, cleaned at
round setup). Findings that rested only on those two files are excluded; the rail findings below stand on code alone.

---

## F1 — `hoverGuard` does not scan `pi-web-plugins/`; two live violations sit in the blind spot — TRUE (high value)

**Where**
- `src/client/src/hoverGuard.test.ts:20` — `const clientRoot = fileURLToPath(new URL(".", import.meta.url));` → scan root is `src/client/src/` only.
- `src/client/src/hoverGuard.test.ts:12` — docstring: *"A bare `:hover` **anywhere** fails here, so the rule cannot quietly grow back in one file while the others stay clean."*
- Violations, unswept: `pi-web-plugins/git/browser/git-panel.ts:1341` and `:1344`
  ```
  .git-panel .git-row:hover, .git-panel .git-row.is-selected { background: var(--pi-selection-bg); }
  .git-panel .git-commit-row:hover, .git-panel .git-commit-row.is-selected { background: var(--pi-selection-bg); }
  ```
  Both change `background` on hover, with no `@media (hover: hover)` on the line — exactly the pattern the guard exists to forbid.
- The rest of the house adopted a two-root convention: `src/client/src/components/pointerQueryOrder.test.ts:18`,
  `boxModelGuard.test.ts:24`, `tokenReferences.test.ts:26`, `spacingScale.test.ts:27`, `dotScale.test.ts:15` all declare
  `const ROOTS = ["src/client/src", "pi-web-plugins"];`. `hoverGuard.test.ts` is the **only** CSS-invariant guard left
  single-root. (`designTokens.test.ts:19-22` is also core-only but *documents* that it is "deliberately about the shared sheets", so it is not drift.)

**Failure scenario** — the guard's own docstring records the bug class: on a coarse pointer the first touch dispatches
`:hover`, the browser withholds the click and demands a second tap. A phone user taps a git row or a commit row in the
Git panel: the background changes under the finger, and on the affected browsers the first tap is eaten. The suite is
green while this ships, and every future plugin CSS edit is unswept, so the count only grows.

**Adjudication: TRUE.** Verified by reproducing the guard's own predicate over `pi-web-plugins/` — only these two lines
trip it; the file was never in scope. The invariant is real, the coverage claim on line 12 is false post-extraction.

**Fix** — one line: mirror `pointerQueryOrder.test.ts:18` (walk `["src/client/src", "pi-web-plugins"]`), then wrap the two
git-panel rules in `@media (hover: hover)` or move the feedback to `:active`.

---

## F2 — Machine rows carry a danger dot and a transparent rail: the shell's rail vocabulary has no machine states — TRUE (medium)

**Where**
- `pi-web-plugins/machines/browser/MachineList.ts:159` —
  `const kind = machine.status === "offline" || machine.status === "error" ? undefined : statusActivityKind(flags);`
  → for a down machine the activity mark is suppressed. With no unread flag, `renderActionActivityIndicator`
  (`pi-web-plugins/machines/browser/activityBadge.ts:31-34`) computes `present = false`, `markKind = "idle"`, and the
  wrapper is `hidden`. So **no** `.activity-indicator.{unread,session,terminal}` class is present.
- `pi-web-plugins/machines/browser/MachineList.ts:264-266` — the row *does* state the same fact loudly:
  `.machine-status::before { … background: currentColor }`, `.machine-status.offline, .machine-status.error { color: var(--pi-danger); }`
- `src/client/src/components/shared.ts:439-460` — every rail rule keys off `:where(.activity-indicator.*, .session-state.*)`,
  `.archived`, `.selected`. There is **no** rule keyed on `.machine-status.*`.
- The rails are genuinely present on these rows: host `listStyles` is injected into the plugin's shadow root per instance
  (`src/client/src/plugins/pluginHostUi.ts:35` → `pi-web-plugins/machines/browser/hostUi.ts:35-41`), and `listStyles` carries
  `.action-row { border-left: var(--pi-rail-width) solid transparent }` (`shared.ts:409`).
- The promise being broken is written in the code that renders the dot: `src/client/src/components/sessionStateBadgeStyles.ts:2-8`
  — the mark and the rail are "one sentence, one place", so a row never "reads as one thing up close and another at scanning distance".

**Failure scenario** — a remote machine is down. In the machines list the row says "Offline" with a red dot, and its rail is
empty. Scanning the 3px edge — the one affordance the whole sidebar uses to say "look here" — the broken machine is
indistinguishable from a healthy idle one. On a phone the machines list is the only thing on screen, so the rail is the only
peripheral cue. Asymmetry: an **unread** offline machine does get a purple rail (the unread label keeps `present` true), so
behaviour differs for the same status depending on a flag that has nothing to do with health.

**Adjudication: TRUE.** Cross-file: the plugin owns the state vocabulary, the shell owns the rail rules, and nobody owns the
join. The rail system was specified over the session vocabulary and the machines axis was later moved into a plugin that
invented a second status vocabulary (`online|offline|error|unknown`) the rail rules were never told about.

**Fix** — add the machine states to the shell's rail table in `shared.ts` (`:where(.machine-status.offline, .machine-status.error)
→ var(--pi-danger)`, `.machine-status.online → var(--pi-success)`), which reaches plugin rows automatically because the sheet is
adopted. Then `MachineList.ts:159` no longer has to choose between dot and rail.

---

## F3 — The whole collapse-toggle chain is unreachable, but the collapsed *state* still steers the UI — TRUE (medium)

**Where (dead wiring)**
- `src/client/src/components/appShell/AppNavigationPanel.ts:361` `renderSessionList(collapsible: boolean, …)` is called with
  `false` at **both** call sites: `:175` and `:242`. Hence `:374` `.collapsible=${collapsible && this.collapsible}` is always
  false, `:375` `.collapsed=${collapsible ? this.sessionsCollapsed : false}` is always false, and the `:376` toggle handler can
  never fire. `PiWebApp.ts:2268` `.collapsible=${true}` therefore has no effect at all.
- `AppNavigationPanel.ts:278` and `:293` — contributed sections get `display: { …, collapsible: false, collapsed: false }`;
  `pi-web-plugins/machines/browser/MachineList.ts:202` `if (!this.collapsible) return html\`<span>Machines</span>\`` — the toggle
  button (and its count) is never rendered. Same for projects/workspaces.
- `PiWebApp.ts:2872`, `:2940` — host-built contexts likewise hard-code `collapsible: false`.
- Dead members this leaves with no reachable caller: `AppNavigationPanel.ts:74-77` (`onToggleMachines/Projects/Workspaces/Sessions`),
  their bindings `PiWebApp.ts:2256, 2283, 2284, 2285`, the `toggleCollapsed` callbacks (`AppNavigationPanel.ts:279, 295`;
  `PiWebApp.ts:2985`), `NavigationSectionsController.toggle` (`src/client/src/appShell/navigationState.ts:85-88`) and
  `toggleNavigationSection` (`navigationState.ts:42-44`, only other referent is `navigationState.test.ts:39-41`).

**Where (state still live — the part that bites)**
- `AppNavigationPanel.ts:264-267` `compactVisibleSection()` still reads `machinesCollapsed/projectsCollapsed/workspacesCollapsed/sessionsCollapsed`,
  all derived from `NavigationSectionsController.expanded` (`navigationState.ts:38-40`). `expand()` and `advanceAfterSelection()`
  still write it, so the accordion model works — but no affordance can ever *close* the open section (`"none"` is now unreachable),
  so the one state the user used to be able to reach from a heading is gone.

**Failure scenario** — a contributor reads four `onToggle*` props plus a `.collapsible` input and wires a new contributed section
to them, and nothing appears (the host overrides `collapsible:false` in its own context object at `AppNavigationPanel.ts:293`,
a third file away from where the props are declared). Conversely, deleting the props is not safe: `compactVisibleSection()` still
reads the `*Collapsed` values, so a naive cleanup that drops them changes which list a phone shows.

**Adjudication: TRUE** (dead affordances; live state). Severity medium because the dead set spans three files and one controller
method, and it is exactly the kind of half-migrated seam the plugin extraction was supposed to close.

**Fix** — delete the four `onToggle*` props + bindings, drop the `collapsible` parameter from `renderSessionList`, drop
`toggleCollapsed` from the two context builders, and delete `toggle()`/`toggleNavigationSection()` (or restore the affordance in
one place). Keep `isCollapsed`, which is live and load-bearing.

---

## F4 — `session-row-indicator` Lit element is never used; it duplicates the badge stylesheet and registers a custom element on boot — TRUE (low-medium)

**Where**
- `src/client/src/components/sessionRowIndicator.ts:99-114` — `@customElement("session-row-indicator") class PiWebSessionRowIndicatorElement`,
  with its own `static styles` (line 25) that re-spells `.session-state.idle/.asking/.error/.background/.unread`, `.state-dots`,
  `@keyframes session-state-bounce` — the same vocabulary `sessionStateBadgeStyles.ts:29-42` already owns.
- Grep over the whole repo (`*.ts`, `*.html`, excluding `node_modules`/`dist`): **zero** templates emit `<session-row-indicator>`.
  Only `renderSessionRowIndicator` + `sessionRowIndicator` are imported
  (`SessionList.ts:16/435`, `QuickSwitcher.ts:9/215`).
- The file's own header (lines 7-13) says the element is "what the row marks look like", i.e. it still advertises the element as the product.

**Failure scenario** — someone retunes the dot in the element's `static styles` (the "single component, single place" the comment
invites), ships it, and sees nothing, because the live marks come from `sessionStateBadgeStyles`. Two stylesheets for one vocabulary
is where drift begins; the drift is already latent (the element's `.running` uses `::after` with `box-shadow` spread sizing —
`sessionRowIndicator.ts:31-32, 83` — while the shared sheet sizes the running mark differently).

**Adjudication: TRUE** as dead code + duplicated presentation contract, and the duplicate is already wrong: the element's own
stylesheet never styles `.state-dot` — the class its template emits at `sessionRowIndicator.ts:68` — and instead carries
`.state-dots .state-dots` (`:32`), a descendant no template produces. Had anyone emitted `<session-row-indicator>`, the running
state would render three zero-size unstyled spans; the live path is styled only by `sessionStateBadgeStyles.ts:40-42`.
Runtime cost is small (one `customElements.define` side effect on boot; the unused CSS is likely tree-shaken from the prod bundle),
so the cost is maintenance, not bytes.

**Fix** — delete `sessionRowIndicatorElement` + its `define` + its `static styles`; keep the decision function and the template
function; fold `.state-dots`/`session-state-bounce` into `sessionStateBadgeStyles.ts` (which the two consumers already adopt).

---

## F5 — `src/client/src/components/activityBadge.ts` is a production-dead twin of two byte-identical plugin copies — TRUE (low-medium)

**Where**
- Production code imports only the **type** `SessionStateBadgeKind` from the core file
  (`quickSwitcher.ts:3`, `QuickSwitcher.ts:10`, `ChatView.ts:24`, `PiWebApp.ts:23`, `SessionList.ts:17`) plus `SESSION_STATE_LABELS`
  (`sessionRowIndicator.ts:2`). `ActivityIndicatorKind` (`:7`), `statusActivityKind` (`:17`), `hasStatusUnread` (`:26`),
  `renderActionActivityIndicator`, `activityBadgeStyles`, `activityIndicatorStyles` have **no production importer** —
  `activityBadge.test.ts:4` is the only reader of the functions.
- Real call sites use the plugin copies: `MachineList.ts:7/161`, `ProjectList.ts:7/236`, `WorkspaceList.ts:7/205`.
- The two plugin copies are **byte-identical** (`md5 aabf50ae0e0c71a2695aedd9f70e04ae` for both
  `pi-web-plugins/machines/browser/activityBadge.ts` and `pi-web-plugins/workspaces/browser/activityBadge.ts`).
- A core test reaches across the boundary to prove it: `src/client/src/components/idleMarkHonesty.test.ts:5` imports
  `../../../../pi-web-plugins/machines/browser/activityBadge.js`.

**Failure scenario** — the ring/unread wrapper rule (the comment at `activityBadge.ts:36-38`: a hidden wrapper would light every
idle row's rail through `:has()`) is fixed in one copy and not the others; the dead core copy keeps passing its own test, so the
suite stays green while one list's rails go purple on idle rows.

**Adjudication: TRUE** (dead code + triplicated mark/ring stylesheet). Not a live bug today: the three copies' logic is identical,
and the mark↔rail rules in `shared.ts:439-450` are worded for all three classes.

**Fix** — delete the dead exports from the core file (keep the type + `SESSION_STATE_LABELS`), and hoist the identical plugin copy
to one shared module that both plugins import through the plugin API seam.

---

## F6 — `retiresOnReply()` is the retirement model's public predicate and nothing in production calls it — TRUE (low)

**Where** `src/client/src/notice.ts:118-120`. Only `notice.test.ts` imports it. Production consumers re-derive the same rule from
the raw field: `PiWebApp.ts:1058` (`clearTransientError`) and `PiWebApp.ts:1095` (`scheduleTransientErrorDismissal`) both test
`state.errorRetiredBy !== RetiredBy.reply`, and `PiWebApp.ts` also guards `=== RetiredBy.reply` again inside the timer body.

**Failure scenario** — the model's one documented rule ("a transport claim is withdrawn by the next successful exchange") gains a
second condition (e.g. only when the socket is not proven live). The predicate is updated, its 8 tests pass, and the two production
call sites keep the old behaviour: banners that should persist still clear themselves.

**Adjudication: TRUE**, low severity (2 sites, easy to see). It is also the exact "producer bypasses the model" pattern this round
was asked to look for — the bypass is not a raw `setState({ error })` (there are none left; see verified list) but a re-implementation
of the predicate next to the helper that owns it.

---

## F7 — `selectedMachineStatusSnapshot()` and its only input are dead, yet the binding keeps forcing re-renders — TRUE (low-medium)

**Where**
- `src/client/src/components/appShell/AppNavigationPanel.ts:409-411` — private method; repo-wide grep finds no call site.
- `AppNavigationPanel.ts:47` — `machineStatusSnapshots` property; its only read is inside that dead method.
- `src/client/src/components/PiWebApp.ts:2254` — `.machineStatusSnapshots=${this.state.machineStatusSnapshots}` is still bound.

**Failure scenario** — `machineStatusController` pushes a fresh snapshot for every machine on every poll
(`src/client/src/controllers/machineStatusController.ts:47-49` writes a new object each time), so the property identity changes and
`AppNavigationPanel` re-renders on every status tick to feed a value nothing reads. The machines section was moved into a contributed
plugin section (`PiWebApp.ts:2855/2939` read the same state for the live host snapshot), and this host-side path was never retired —
so a future reader "restores" machine status rendering inside the panel, creating a second owner for machine status.

**Adjudication: TRUE** — dead leftover of the machines extraction, with a measurable (if small) re-render cost.

---

## F8 — Local-machine plugin-backend traffic is invisible to the transport-recovery arbiter — TRUE (low)

**Where**
- `src/client/src/api/pluginBackends.ts:37-39` — the request path drops the machine scope for local:
  `target.machineId === "local" ? "api" : \`api/machines/${…}\``.
- `src/client/src/api/transportHealth.ts:30-32` — `machineIdFromUrl` matches `/\/machines\/([^/]+)/`, so those URLs return
  `undefined`, i.e. "web-owned, proves nothing about any machine" (documented as intentional at `:24-29`).
- But that route *is* served by the local daemon: `src/server/web/plugins/pluginBackendProxyRoutes.ts:22-29` forwards to
  `daemon.request(...)` and 502s as `daemon-unavailable` when it is not there.
- Same root, second symptom: `notice.ts:107` scopes a `RequestTimeoutError` with `machineIdFromUrl(error.url)`, so a deadline miss on a
  local plugin backend gets page scope while the identical call against a remote machine gets that machine's scope.

**Failure scenario** — the local daemon is restarted (the commonest banner source, per `errorBanner.ts:55-58`). The banner reads
"local is unavailable; reconnecting…" scoped to `machineId: "local"` (`machineController.ts:181` passes the machine id). Meanwhile the
user's only traffic is a plugin-backend call that now succeeds through the daemon — the recovery report says `undefined`, and
`PiWebApp.ts:1060-1061` treats the claim as not disproved, so the banner keeps its words until an unrelated `/api/machines/local/...`
request happens to answer. Identical user action (a plugin call succeeding) retires the banner for a remote machine and not for the local one.

**Adjudication: TRUE**, low severity in practice — the selected machine's status polling uses
`api/machines/local/...` (`src/client/src/api/clients.ts:76`, `src/client/src/api/urls.ts:28,43`), so a banner normally heals within
one poll. The inconsistency is real and cheap to remove.

**Fix** — emit `api/machines/local/...` for local too (or have `pluginBackendRequestPath` keep the scope while the server keeps
serving both), so one URL rule describes provenance for every backend.

---

## F9 — Two transport-phrase tables that must match, and don't — TRUE (low; latent)

**Where**
- `src/client/src/components/errorBanner.ts:95` — `/^(failed to fetch|load failed|networkerror when attempting to fetch resource)[.!]?$/i`
- `src/client/src/notice.ts:106` — `/^(failed to fetch|load failed|networkerror when attempting to fetch)[.!]?$/i` (no ` resource`)
- `errorBanner.ts:33-36` presents itself as *the* classification seam ("notice.ts asks it whether an error's text carries transport
  evidence … and the banner asks it how to shorten"), i.e. one table for both questions. `notice.ts:106`'s extra branch is a second table.

**Failure scenario** — text matching only the broader copy (Firefox wording without the trailing "resource", e.g. a proxy or a future
browser that trims it) is classified reply-retired by `notice.ts` but returns `undefined` from `normalizeTransientError`, so
`scheduleTransientErrorDismissal` bails at `PiWebApp.ts:1096` and `errorBanner` renders it as a permanent red `role="alert"`. The claim
says "the link is down and this heals", the chrome says "broken until you act", and it never expires on its own.

**Adjudication: TRUE as a duplicate-table divergence; FALSE as a live bug today** — the three real browser strings
(Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError when attempting to fetch resource.") all land in the
intersection, and `errorBanner.ts:50` is reachable from `notice.ts` via `isTransientError` (`errorBanner.ts:38-40`). The narrower copy
is currently unreachable. Report it as the maintenance hazard it is: two regexes with one job, free to drift.

**Fix** — delete `notice.ts:106`'s inline alternative (the `isTransientError(text)` call already covers every phrasing the display side
recognises), or export the anchored phrase list from `errorBanner.ts` and use it in both.

---

## Checked and clean (so the next lane does not redo it)

1. **No notice/retirement bypasses.** Every error write in app code goes through `errorNoticePatch` / `noticePatch` / `clearErrorPatch`;
   no `setState({ error: … })` remains outside `notice.ts`/`errorNotice.ts`. `docs/design/operation-model.md:29-31`'s claim that no
   production caller passes the `link` verdict is accurate — `errorNoticePatch`'s `link` default `{ live: false }` is never overridden.
2. **Rail source order encodes precedence correctly** (`shared.ts:439-460`: unread/activity → running → asking → terminal → error →
   archived → selected, all at equal specificity via `:where()` inside `:has()`), and the arbiter
   (`src/client/src/components/sessionRowIndicator.ts:44-57`) resolves exactly one kind per row, so no two rail classes can co-occur on
   one session row. The "unread class is unconditional" comment is accurate: the row-level `.action-row.unread` cannot match its own
   descendant `:has()` rule.
3. **`pointerQueryOrder`, `boxModelGuard`, `tokenReferences`, `spacingScale`, `radiusScale`, `typeScale`, `dotScale`,
   `controlHeightScale` all guard across the plugin boundary** (`ROOTS = ["src/client/src", "pi-web-plugins"]`). `hoverGuard` (F1) is the sole exception.
4. **Quick Switcher is alive**, not switcher residue: `PiWebApp.ts:2272 .onQuickSwitch` → `AppNavigationPanel.ts:188`.
5. **`openLazySurface` (`PiWebApp.ts:~1826`)** uses `errorNoticePatch(new Error(…))` for the load failure and clears by exact-string
   comparison. Correct under the model (reader-retired), but the clear is string-coupled — worth a shared constant if it is ever reworded.
6. **`machineIdFromUrl` + `clearTransientError` scoping is sound for `HttpError`/`TypeError`**: a `TypeError` means the browser↔web hop
   failed, so page scope is right; `RequestTimeoutError` carries a URL and gets machine scope. Only the local-plugin-backend case (F8) is off.
7. **`bannerHoldDecision`** (`src/client/src/components/bannerHold.ts`) matches its documented behaviour, and the re-raise/dedupe
   interaction the doc calls "swallowed" is intentional and re-armed correctly (`PiWebApp.ts:3849-3856` resets
   `lastScheduledError` whenever text or machine changes, and `clearTransientError:1068` resets it on withdrawal).
8. **Token duplication checked**: `--pi-rail-width` is defined once (`src/client/index.html:90`); `--pi-sidebar-width` and friends
   are `calc()` expressions of it as the comment claims. `src/client/index.html` contains no `:hover` at all, so the guard's root
   choice has no HTML blind spot. Two rail consumers exist besides rows: `SessionTreeNavigator.ts:554,557` and
   `pi-web-plugins/git/browser/git-panel.ts:1353` (both consume the token rather than restating 3px — good).

## Cross-cutting read

The three strongest findings (F1, F2, F8) share one shape: **an invariant that was enforced shell-wide before the extraction is now
enforced only inside `src/client/src`, while the behaviour that must satisfy it lives in `pi-web-plugins/`.** F1 is a literal scan-root
bug; F2 is a style table that never learned the plugin's vocabulary; F8 is a URL rule that no longer describes what a plugin builds.
If round 26 wants one systemic fix: make the plugin boundary a first-class citizen of every cross-file guard and every
shell-owned vocabulary table, and delete the extraction leftovers (F3, F4, F5, F6, F7) so the boundary has one owner per decision.
