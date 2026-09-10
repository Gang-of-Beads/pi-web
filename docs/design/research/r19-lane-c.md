# Round 19 — lane C: banner retirement model, switcher removal, rail rules, docs-vs-code

Scope reviewed: notice.ts, errorNotice.ts, errorBanner.ts, bannerHold.ts, transportHealth.ts,
http.ts, requestDeadline paths, appState.ts, PiWebApp.ts, machineController.ts,
sessionController.ts, reportedError.ts, QuickSwitcher.ts, shared.ts rail CSS,
sessionRowIndicator.ts, sessionStateBadgeStyles.ts, machines/workspaces plugins,
scripts/audit-uiux-full.mjs, round17/round18 triage docs, changesets/banner-retirement-model.md,
commits 646a0d5a / ed0cd40f / b0bce2a0. All findings reproduced from source at HEAD ed0cd40f.

## Findings (adjudicated)

### C1. TRUE, P1 — QuickSwitcher row-menu fix (round-18 item 10) is committed but never reaches the DOM
`src/client/src/components/QuickSwitcher.ts:243` reads, byte-for-byte (verified with `od -c` and
`git show ed0cd40f:...`):

```html
<div class="action-menu-panel row-menu" role="menu" style=undefined>
```

Not `style=${this.menuStyle}` — the literal text `undefined`. Every sibling binds correctly
(SessionList.ts:433, MachineList.ts:178, WorkspaceList.ts:237, ProjectList.ts all use
`style=${this.menuStyle}`). Consequences:

1. `openRowMenu` (:236-238) computes `actionMenuPanelStyle(...)` and stores it in `@state()
   menuStyle` (:71) — which no template consumes. The viewport-constrained top/right/max-width/
   flip-above logic never applies.
2. The panel gets a static `style="undefined"` attribute (invalid inline CSS; browsers drop it).
3. `.action-menu-panel` still supplies `position: fixed`, so with all offsets auto the menu lands
   at its static layout position: it still does not follow the scrolling list, can hang off the
   viewport edge, and never flips above near the bottom — exactly the round-17 defect round 18
   claims fixed ("fixed and viewport-constrained like every other row menu").
4. The long-press path (`onLongPress`, :76) sets `openMenuSessionId` without ever computing a
   style at all — a second gap the binding fix alone would not cover.

Failure scenario: phone user long-presses the last session row in quick switch near the viewport
bottom; the menu opens at the static position, overflows below the keyboard, with no
`max-height` clamp. No test asserts the panel receives the computed style
(QuickSwitcher.test.ts only queries `.row-menu button`), so the suite stays green — the same
"verification flag printed but unread" failure mode the round-18 doc says was fixed this wave.

### C2. TRUE, P1 — round-18 item 8 ("every remaining `setState({ error })` producer travels with its
retirement mark") is false; bare writes now inherit a stranger's lifetime

Unconverted producers, confirmed against HEAD (blame dates 2026-06/07, untouched by the wave):
- `src/client/src/controllers/sessionController.ts:532` — "The backend session is not ready for
  queued sends. Copy your message before discarding this failed start."
- `src/client/src/controllers/sessionController.ts:655` — "Queued command “…” needs input; open
  the session and run it again."

Neither the round-17 wave (646a0d5a), b0bce2a0, nor ed0cd40f touched these lines, yet round18.md
item 8 and the b0bce2a0-era claim state the sweep is complete.

Why this is worse than pre-round-17, not neutral: clear paths leave `errorRetiredBy` behind.
- `clearTransientError` (PiWebApp.ts:1032-1041) resets `errorMachineId` to "local" but keeps
  `errorRetiredBy: "reply"`.
- the 6s expiry timer (:1063), `ReportedError.clear()` (reportedError.ts:29), banner dismiss
  (:3799), the module-load-failure clear (:1771) and the machine/workspace switch clears
  (`resetWorkspaceScopedState`, appState.ts:191; machineController.ts:14/69/81) write bare
  `{ error: "" }` — some resetting neither scope nor mark.

Failure scenario (fully traced):
1. Transport blip → `Failed to fetch` via `noticeFromTransport` → `errorRetiredBy = "reply"`.
2. A success clears it via :1036 — mark stays `"reply"`.
3. The 6s timer path (:1063) leaves mark `reply` **and** a stale `errorMachineId` (e.g. "m-B") —
   contradicting round-18 item 5's "a cleared banner resets it".
4. User queues a send into a discarded pending session → bare write at :532 → the instruction
   inherits `retiredBy: "reply"` and possibly `machineId: "m-B"`.
5. `scheduleTransientErrorDismissal` (:1059) sees `reply` → the message self-expires after 6s;
   any matching-scope success can clear it sooner. The reader who was told "copy your message
   before discarding" gets the "red flash, no explanation" behaviour the retirement model was
   built to eliminate. If the inherited scope is "m-B" while the reader is on machine A, the
   message instead survives every A success *and* expires at 6s — both failure halves at once.

The two writes are one-line fixes each: `this.setState(errorNoticePatch(noticeForReader(...)))`
or `noticePatch(noticeForReader(text))`.

### C3. TRUE, P2 — the self-healing wording table's flagship rule is unreachable in production;
every self-update now leaves a raw ENOENT red alert
`errorBanner.ts:59` normalizes `Session daemon … unavailable: connect ENOENT …/sessiond.sock` to
"Reconnecting to the session daemon…", but the gate is `retiredBy === "reply"` (:24) and *every*
producer of that text is a 502 body: `sessionProxyRoutes.ts:67`, `pluginOperationProxyRoutes.ts:33`,
`pluginBackendProxyRoutes.ts:32`, `workspaceDeletionRoutes.ts:38`,
`sessionDaemonWorkspaceCatalog.ts:68` ("Session daemon workspace authority unavailable: …" — the
generalized regex does match this variant, the comment's claim is fine). A 502 is an `HttpError` →
`noticeFromError` → `noticeForReader` (notice.ts:88) → the gate skips the rewrite. The rule's own
comment says "it is what an update looks like", and `isTransientError` (:37) is exported "so the
owner of the banner can let those expire on their own" — but `isTransientError` has **zero
production callers** (grep: only its definition and errorBanner.test.ts) and the expiry now keys
on the retirement mark, so the export comment is also stale.

Failure scenario: reader presses the self-update button; the daemon restarts; any proxied poll
fails with 502 "Session daemon unavailable: connect ENOENT /…/sessiond.sock"; a raw red `role=alert`
banner sits there after the daemon is back, dismissible only by hand — while the changeset says
genuine link failures "heal by themselves". errorBanner.test.ts calls `errorBanner(error, onDismiss)`
with the default `retiredBy = "reply"`, so the rule keeps a green test while production cannot
reach it. Either the daemon-unavailable family deserves an explicit reply-retirement (it asserts
the *daemon link*, an answer from it disproves it), or the rule/comment/test should be deleted —
but today code and documentation disagree about what ships.

### C4. TRUE, P2 — `errorNoticePatch` stamps every machine-scoped timeout as a "local" claim;
round-18 item 5's scope fix covers the seam's callers only where the seam is bypassed by default
`errorNotice.ts:27-28` always writes `errorMachineId: "local"`. For HttpErrors the scope is inert
(reader-retired), and a TypeError can only mean the local gateway is down (all client traffic is
proxied through it), but **RequestTimeoutError on a machine route is reply-retired with the wrong
scope**: `machineController.refreshMachineHealth/:130` and `refreshMachineRuntime/:138` fetch
`/api/machines/<id>/health|runtime` — a slow *remote* machine (the 30s browser deadline is exactly
what remote boxes hit; notice.ts:92-94 measures one) produces a reply claim scoped "local".
Failure scenario: machine B answers at 31s; the banner claims "the link is down" scoped local; the
next local success (:1032-1036) withdraws it while B is still not answering, and the claim can
also be withdrawn by machine A's polls. The same controller does it correctly three methods
later — `selectInitialMachine` at :154 uses `noticePatch(noticeFromTransport(text, machineId))`
with a comment explaining exactly this. Same file, same round, two conventions.

### C5. TRUE (known, still open), P3 — `link.live` timeout suppression remains unwired; the
changeset's decision-3 claim is nominal in production
`notice.ts:78` (`RequestTimeoutError && link.live → NO_NOTICE`) is unreachable: the only production
producer path is `errorNoticePatch`, whose `link` parameter defaults to `{ live: false }`
(errorNotice.ts:25) and no call site passes a second argument (full grep of `errorNoticePatch(`
and `noticeFromError(` call sites). Round-18 recorded this as deferred with reason, so it is not
a regression — but changeset banner-retirement-model.md still asserts "deadline misses no longer
speak for the page while the socket is answering" in the indicative, and today a deadline miss on
any route still raises a reply-retired banner (mitigated: rewritten by the "did not answer
within" rule to a transient line and expired at 6s).

### C6. TRUE, P3 — interrupted-runs banner: announce has no machine guard, retract does; the
string-literal coupling persists
`PiWebApp.ts:775` announces "Interrupted-run status is unknown: the read failed…" whenever
`state.error === ""` — **without** the `selectedMachineId(this.state) !== machineId` guard that
the retract at :778-782 has, and without naming the machine. A background machine's failed read
therefore claims an unprefixed red reader-retired banner on a screen about a different machine,
and only an identical success on *that* machine (or a machine switch) retracts it. The retract
matches the full literal (:782 vs :775) — two copies of one sentence in one function, whose
sync no test or shared constant protects; editing one silently strands the other (banner can
never be retracted by recovery, or recovery clears an unrelated same-worded banner). The
announce-only-on-quiet-screen and the read→`undefined` (unknown) distinction themselves are
correct as claimed.

### C7. TRUE, P3 — three clear sites keep round-18 item 5's promise only partially
Round-18 item 5: "The seam now always writes the scope, and a cleared banner resets it."
True at `clearTransientError` (:1036) and user dismiss (:3799); **false** at the 6s expiry
(:1063, clears text only), `ReportedError.clear()` (reportedError.ts:29), and the module-load
failure path (PiWebApp.ts:1771 area). Each leaves `errorRetiredBy` (and some `errorMachineId`)
poisoned for the next *bare* producer (see C2) or for a later reader of the state. Harmless
while every producer goes through the seam — C2 shows it is not.

### C8. FALSE (correction to r18 C13), P3 — `display.tiles` is not dead
The machines plugin ignores `tiles`, but the workspaces plugin consumes it:
`pi-web-plugins/workspaces/browser/pi-web-plugin.ts:39,63` (`.tiles=${display.tiles}`) feeding
WorkspaceList.ts:56 and ProjectList.ts:47. Any dead-parameter sweep that deletes `tiles` would
break the workspaces grid mode. (Machines-plugin claim about its own list rendering is accurate:
`machine-list` renders everywhere, header/switcher mounts gone — verified this round.)

### C9. TRUE, P3 — rail CSS: color table matches the dots, but one rule lives only on source order
Verified the changeset's claim per state: running `.state-dot` wears `--pi-accent`
(sessionStateBadgeStyles.ts) and rail paints `--pi-accent` (:445); asking→warning (:446);
unread/background→purple (:443, hollow ring is purple); error→danger (:448); machine/workspace
`.activity-indicator.session` rail success matches the success dot; idle correctly gets no rail.
Two residuals:
- `.session-state.running` is a member of the *success* rule (:444) and is rescued from green
  only by the accent rule appearing later at equal specificity (:445). Swap the two lines and
  every working row's rail goes green under a blue dot. The audit-uiux order guard covers the
  self-update media block in PiWebApp, not this pair in shared.ts.
- Comment at shared.ts:436 still cites "row-class rules below (unread/archived/selected)" —
  `.action-row.unread` was deleted this wave (:449-450 are archived/selected only). Same
  false-verification signature as round 18 item 4's own text.

### C10. TRUE, P3 — AppNavigationPanel residuals
- Docblock above `renderContributedSections`: "Goals are workspace context rather than a
  navigation step…" describes nothing in the file — goals rendering left this module in an
  earlier round; the comment now mislabels a generic contribution hook.
- `[collapsed]` attribute selectors for `machine-list`, `project-list`, `workspace-list`,
  `session-list` are dead: every call site passes `collapsible=false`, so the attribute is never
  set. (These were the switcher-era CSS; round-18 item 11 removed switcher mentions from docs
  but not these rules.)

### C11. TRUE, P3 — `onPluginNotice` is a fourth producer outside the seam
`PiWebApp.ts:3888`: `this.setState({ error: message, errorRetiredBy: RetiredBy.reader })` —
carries a mark but no `errorMachineId`, contradicting errorNotice.ts's "The one way a controller
reports a failure" header and item 8's "every producer travels with its mark" only partially
(it has a mark but inherits whatever stale scope C7 left). Inert today because reader-retired
claims ignore the scope — inert by luck, not by construction.

### C12. TRUE (note), P3 — recovery is only reported on 2xx
`http.ts:53` calls `reportTransportReachable` after a parsed success; a 500 from the same origin
also disproves "the link is down" but does not retire a reply-retired claim (it usually replaces
the banner with a reader one, masking this). Also confirmed: `transportHealth` is a
single-listener registry set in `connectedCallback` (:986) and cleared in
`disconnectedCallback` (:1067) — no leak; machineId extraction `/\/machines\/([^/]+)/` +
`decodeURIComponent` matches how controllers scope claims.

## Claims verified TRUE as stated
- The 6s expiry checks the retirement mark, not wording (:1059); hold/expiry are per-message
  (`lastScheduledError`, :3793-3797); leaving the screen resets the schedule (bannerHold.ts).
- `clearTransientError` refuses cross-machine clears (:1033) and the URL vouching is per-machine
  as committed ("vouches for the machine the URL addressed instead of the world").
- Machine switch clears the banner text (`resetWorkspaceScopedState`, appState.ts:191), so the
  exhausted remote-route claim (:1519-1531, reply + machine-scoped) cannot follow the reader to
  another machine — it only lingers on the machine it describes until that machine's success,
  which is the model's own rule.
- HttpError→reader, TypeError→transport, RequestTimeoutError→transport classification is
  consistent across the seam; `describeError` covers the "HttpError"/"[object Object]" shapes.
- Machines plugin: single `machine-list`, no `MachineSwitcher`/`machine-switcher` reference in
  live source (only `dist/` build artifact and out-of-scope docs/design draft); audit script no
  longer matches "Switch" and the 20×250ms poll is bounded as claimed.

## Suggested fix order
1. QuickSwitcher.ts:243 → `style=${this.menuStyle}`, plus compute the style in `onLongPress`;
   add a test asserting the panel's inline style is non-empty after opening. (C1)
2. Convert sessionController.ts:532/:655 to `noticePatch(noticeForReader(...))`; move the
   interrupted-runs sentence to a shared const used by :775 and :782. (C2, C6)
3. Decide the daemon-502 family (reply-retire at the seam or delete the wording rule +
   `isTransientError` export) and align the changeset wording. (C3)
4. Thread `machineId` into `errorNoticePatch` for reply-retired notices, replacing the hardcoded
   "local" stamp; extend to machineController:130/:138. (C4)
