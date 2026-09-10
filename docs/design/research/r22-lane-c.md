# Round 22 — Lane C: whole-file cross-check (cross-file inconsistency, dead leftovers, docs vs code)

Reviewed at HEAD `436c4159` ("Start convergence round 22"). `git diff --stat HEAD -- src` is empty, so
everything below describes committed content. No round-22 changeset exists yet; this lane's output is
input to the fix round.

Scope read end-to-end (no per-file split): `notice.ts`, `errorNotice.ts`, `errorBanner.ts`,
`transportHealth.ts`, `http.ts`, `requestDeadline.ts`, `bannerHold.ts`, `appState.ts`,
`machineController.ts`, `sessionController.ts`, `PiWebApp.ts` (notice/ladder/health/render paths),
`AppNavigationPanel.ts`, `SessionList.ts`, `ExtensionDialogCard.ts`, `SettingsMachinesPanel.ts`,
`SettingsDialog.ts`, `shared.ts`, `disclosureIcon.ts`, `sessionRowIndicator.ts`,
`sessionStateBadgeStyles.ts`, `machineProxyRoutes.ts`, plus round 17–21 triage docs and AGENTS.md.

Verdict: **6 TRUE, 11 adjudicated FALSE**. Nothing here contradicts the notice model's *documented*
contract; five findings are places where a producer or a consumer silently breaks that contract.

---

## TRUE findings

### C1 — `noticeFromError` throws away the machine scope it was handed (Medium)
`src/client/src/notice.ts:93-95`

```ts
if (isTransientError(text) || /failed to fetch|load failed|networkerror when attempting to fetch/i.test(text)) {
  return noticeFromTransport(text, error instanceof RequestTimeoutError ? machineIdFromUrl(error.url) : undefined);
}
if (error instanceof HttpError) {
  return error.machineId !== undefined ? noticeFromTransport(text, error.machineId) : noticeForReader(text);
}
```

The producer deliberately names the machine. `src/client/src/api/http.ts:54-60` reads `error`, `detail`
and `machineId` out of the gateway body, composes `` `${label} (${detail})` `` and throws
`new HttpError(text, status, machineId)`; its own comment calls that "a transport claim that names its
machine". The gateway builds it at `src/server/web/machines/machineProxyRoutes.ts:365-373`
(`"Remote machine unavailable"` / `"Remote machine timeout"`, statusCode 502/504, machineId, detail).

That text matches `errorBanner.ts:98` (`/^remote machine (unavailable|timeout)/i`), so it takes the first
branch — which scopes only `RequestTimeoutError` and passes `undefined` for the `HttpError` sitting in the
same expression. One line later (notice.ts:97-98) the code uses `error.machineId`, so the knowledge exists
and is discarded by ordering, not by design.

Minimal failure: reader selects remote machine B (`lab-mac`, tunnel down).
`machineController.refreshMachineHealth("machine-b")` → `GET api/machines/machine-b/health` → gateway 502
body `{error:"Remote machine unavailable", machineId:"machine-b", detail:"connect ECONNREFUSED 127.0.0.1:7001"}`
→ notice text `"Remote machine unavailable (connect ECONNREFUSED 127.0.0.1:7001)"`, retiredBy `reply`,
**machineId `"page"`**. Consequences, all observable:

1. *Wrong evidence retires it.* `clearTransientError` (PiWebApp.ts:1047-1055) only lets a reply from the
   claimed machine withdraw the claim. Page-scoped, any successful response — the `/api/status` poll,
   machine A's project list — withdraws a banner about B. The machine-scoping the model exists to provide
   is exactly what this class of failure loses, and this class is the commonest multi-machine failure there is.
2. *The machine's name is deleted from the reader's view.* `errorBanner` (errorBanner.ts:22, 98) rewrites a
   reply-retired string to `"Reconnecting to the machine…"` — no machine. The scoping field and the name
   that would have justified it are dropped together.
3. *The same failure yields two different banners.* `machineController.ts:157-161` composes its own
   `"Lab Mac is unavailable; reconnecting…"` scoped to the machine (and `errorBanner`'s `composed` guard
   protects it from the rewrite), while `machineController.ts:131` / `:145` route the identical failure
   through `errorNoticePatch(error)` → this branch → "Reconnecting to the machine…", page-scoped. Selecting
   a machine through the initial-route path and through the picker/refresh path gives the reader two
   different sentences about one event.

Fix: scope from the evidence the value actually carries —
`error instanceof HttpError ? error.machineId : error instanceof RequestTimeoutError ? machineIdFromUrl(error.url) : undefined`.
`notice.test.ts` has no case for a transport-shaped `HttpError` with a `machineId`; that case is what keeps
this from regressing back.

### C2 — the health/runtime late-failure guard cannot detect the thing its comment claims (Medium)
`src/client/src/controllers/machineController.ts:119-134` (health), `:136-146` (runtime)

```ts
} catch (error) {
  // A late failure must not paint its machine's complaint onto the
  // machine the reader has since switched to.
  if (this.healthRefreshSeqByMachine.get(machineId) !== seq) return undefined;
  this.setState(errorNoticePatch(error));
```

`healthRefreshSeqByMachine` is keyed by machineId, so the counter only moves when *that same machine* is
re-polled. A machine switch does not touch it. `errorNoticePatch` writes the banner unconditionally, with
no `selectedMachineId` check — and the page-level write lands even though C1 has just stripped the scope.

Minimal failure: reader clicks machine A (tunnel slow). `selectMachine` (machineController.ts:38-66) resets
state and fires `refreshMachineHealth("machine-a")`. Reader immediately clicks machine B; B loads in 400 ms.
A's request dies at +3 s (`Failed to fetch`). A's seq is unchanged → guard passes → banner
"Lost connection to PI WEB. Reconnecting…" appears over B's fully working session list.

The codebase already has the correct guard twice over: `projectController.ts:47`
(`if (selectedMachineId(this.getState()) === machineId)`) and `PiWebApp.ts:778`
(`if (selectedMachineId(this.state) !== machineId) return …`) for the same hazard. This is the third copy
of the pattern with the check missing, which is why it survived: the comment reads like a checked invariant.

### C3 — the retry ladder's terminal message is auto-withdrawn 6 s after it stops trying (Medium)
`src/client/src/components/PiWebApp.ts:1524-1528`, `:1533-1544`, `:1064-1079`, `errorBanner.ts:47`

`setRemoteRouteRestoreMessage` raises every ladder message through `noticeFromTransport`, i.e. reply-retired.
`scheduleTransientErrorDismissal` then gives any reply-retired banner `TRANSIENT_ERROR_TIMEOUT_MS` = 6000 ms
to withdraw itself. For the four "still trying" messages that is defensible; for the exhausted one it is a
contradiction, and the ladder is over by then:

* `REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 15_000, 30_000]` (PiWebApp.ts:257) runs ~57 s;
* the final call is `setRemoteRouteRestoreMessage(route, { exhausted: true })` → `"Lab Mac is still unavailable."`;
* `clearPendingRemoteRouteRestore()` guarantees no further attempt, and `shouldRefreshMachineActivity`
  (PiWebApp.ts:4022-4026) stops polling a machine whose status is `"offline"` — which is precisely what
  `safeRemoteHealth` (machineController.ts:170-176) recorded. So nothing re-asserts the claim either.

Minimal failure: reader on a phone opens a shared link to a session on a remote machine whose tunnel is down.
After ~57 s of retries the banner says "Lab Mac is still unavailable." — six seconds later it is gone, and the
reader is left on their local machine's session list with no explanation of why the link they tapped has no
session in it. Round-21 triage records this ladder as ending "by saying so"; the retirement model unsays it.

Second symptom from the same interaction, during the ladder: the retry attempts re-raise *identical* text, and
`scheduleTransientErrorDismissal` deliberately does not re-arm a timer for text it already scheduled
(PiWebApp.ts:1070-1073). Net visible behaviour is a banner blinking on and off — up for ≤6 s, gone for the
gap until the next attempt (7 s, then 9 s, then 15 s), each appearance governed by whichever timer happened
to be armed. Whether the terminal message survives to 63 s or is cleared by a stale timer depends on where the
ladder's attempts land relative to the first show, not on what any of the messages assert.

Suggested direction: let a notice declare it is terminal (or give `noticeFromTransport` a "still retrying"
flag) and skip the auto-expiry for claims with no re-raise path behind them.

### C4 — a reader-retired notice whose only exit is an exact string match (Low, fragility)
`src/client/src/components/PiWebApp.ts:783` and `:792`

```ts
783:  this.setState(errorNoticePatch(new Error("Interrupted-run status is unknown: the read failed. Retrying the connection will resolve it.")));
792:  if (this.state.error === "Interrupted-run status is unknown: the read failed. Retrying the connection will resolve it.") this.setState(clearErrorPatch());
```

The notice is hand-raised as `retiredBy: reader` (the text matches no rule in `normalizeTransientError`, and
`errorBanner` skips the rewrite for reader-retired text anyway), so a successful exchange elsewhere does not
withdraw it. The one and only exit is the literal comparison at 792 — and the text itself promises
"Retrying the connection will resolve it" while its retirement is not reply-based.

Minimal failure: someone rewords 783 for clarity ("…will resolve it." → "…should resolve it."). Line 792
still compares against the old sentence, so after a *successful* retry the red banner keeps asserting
"status is unknown" over a transcript that has just re-rendered the resolved interrupted markers — permanently,
until dismissed by hand. Nothing catches it: no test file mentions either string, and both sites are inside
large methods with no unit seam. The two literals are also an untyped contract between two statements 9 lines
apart; a `const` at module scope costs nothing.

### C5 — `openLazySurface` has the same wording-match retirement (Low, fragility)
`src/client/src/components/PiWebApp.ts:1785` (compare) / `:1793` (raise)

`` const failure = `${title} could not load. This tab may be running an older version - reload to get it.` ``
→ `errorNoticePatch(new Error(failure))` on failure; `if (this.state.error === failure) this.setState(clearErrorPatch())`
on success. The comment says this is intentional ("which the success path's text match then retires on retry"),
which makes it a documented second instance of the pattern C4 — the notice model exists so retirement follows
what a message asserts rather than what its words are. Today `title` is one of two fixed strings (line 2108),
so both sides agree; the fragility is identical to C4 and worth folding into one fix.

### C6 — dead leftovers: an unread bound property and 26 orphaned CSS rules (Low)
1. `src/client/src/components/appShell/AppNavigationPanel.ts:47` declares
   `@property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {}`, bound from
   `PiWebApp.ts:2216`. Inside the panel, nothing reads it — the only status consumer is
   `machineStatusSnapshots` (declared :48, read :411). `git log -S` puts the last read in `ebfb2de2`
   ("Move the machine fleet UI into the machines plugin's browser module"), which deleted the two
   `.statuses=${this.machineStatuses}` bindings and left the declaration plus the binding. Every
   `machineStatuses` write (`machineController.ts:106/125/157/187` all build a fresh object) therefore
   triggers a Lit `requestUpdate()` and a full navigation-panel re-render for a value no template reads.
   The same property *is* live in `SettingsDialog.ts:39 → SettingsMachinesPanel.ts:56`, so only this copy
   goes. No test sets it on the panel.
2. CSS selected for a class no template emits any more (the DOM went in `e491ab2e`, `d56666e6`,
   `ebfb2de2`; 26 rules in 5 files):
   * `src/client/src/components/shared.ts` — `:165` `.workspace-header-scroll-frame`, `:167-169` its
     `::before`/`::after` fades, `:170` `.workspace-header-scroll-frame.can-scroll-left|right`, `:171`
     `.workspace-header-strip`, `:172-174` `.tabs`, `.tabs button`, `.tabs button.icon-tab`, `:177`
     `.tab-icon`, `:178-179` `.tab-custom-icon` (+ `svg`), `:180` `.tab-label`, `:181` `.tab-badge`,
     `:183-184` the two `@container` copies of the icon-tab rules. No behaviour is missing: the scroll-edge
     fades that survive are ChatView's own `.drawer-tabs-frame.can-scroll-*` rules (`ChatView.ts:145`, fed by
     `scrollEdges.ts:27`), and no template anywhere emits a bare `class="tabs"`.
   * `PiWebApp.ts` — `:137` `.context-chip:hover`, `:141` `.context-kind`, `:142` `.context-value`, `:143`
     `.tab-badge`, `:144` `.workspace-panel-edge`, `:145` `.shell.workspace-panel-collapsed
     .workspace-panel-edge-button` (the edge control is now the `<app-panel-edge-control>` element, styled by
     tag selector at `PiWebApp.ts:154/170`).
   * `SessionList.ts:774-775` `.subtree-chevron` — the chevron moved to `disclosureIcon.ts`, which owns the
     rotation (`disclosureIconStyle`, `.disclosure-icon.expanded`, sheet applied at `SessionList.ts:685`); the
     toggle button emits `class="subtree-toggle"` (`:465/:470`). Pure leftovers.
   * `ExtensionDialogCard.ts:485-493` `.closed-summary` — the markup emits `class="answered-answer"` (`:260`)
     and is styled by `.answered-row .answered-answer` (`:513`); this is the pre-rename rule.
   * `SettingsMachinesPanel.ts:101` `.machines-heading`.

   Verified mechanically: every class token in every `css` block under `src/` and `pi-web-plugins/`, with the
   third-party `cm-*`/`xterm-*` sets excluded, searched across all of `src`, `pi-web-plugins` and `scripts` —
   these 26 rules' class tokens appear nowhere outside their own selector (`.tab-badge` sits in two sheets;
   the live badge is `drawer-tab-badge`, `ChatView.ts:160`). No CI test guards this, so it will keep re-accumulating.

---

## Adjudicated FALSE (checked, with the scenario that would have made it TRUE)

1. **Bare producers not converted to the notice model.** `error: "<literal>"` writes outside the helpers: only
   `authDialogError`, `machineStatus`-scoped sub-fields and dialog-local fields — none of them the top-level
   banner. Every banner write goes through `errorNoticePatch` / `noticePatch` / `clearErrorPatch`. The two
   wording-literal producers are C4/C5.
2. **MachineSwitcher removal leftovers.** No `MachineSwitcher` / `machine-switcher` identifier in `src/` or
   `pi-web-plugins/` (only in historical `docs/design/research/*`). Its CSS went in `b0bce2a0`; `machineFlags`
   survives and is used by `MachineList`; no orphan import, no orphan selector.
3. **Rail-state precedence vs the documented order.** All six `.action-row :has(:where(…))` rules are
   specificity (0,1,0) (`:where()` contributes 0, `:has()` takes its argument's), so source order decides:
   unread < running < asking < error, and `.action-row.selected` / `.archived` (0,2,0) still win. Matches
   `sessionRowIndicator.ts` arbiter priority (asking > running > unread > error > background > idle).
4. **Indicator colours drift between rail and dot.** Rail colours match `sessionStateBadgeStyles.ts`
   dot colours row-type by row-type (amber/blue/purple/red/purple-ring/gray). No drift.
5. **`:hover` rules without a pointer guard.** Mechanical sweep over every `css` block in `src/` +
   `pi-web-plugins/` and over `src/client/index.html`, tracking `@media`/`@supports` nesting: 0 unguarded
   `:hover`. (The marketing `docs/styles.css` is outside the app's touch contract and was not counted.)
6. **`requestDeadline.ts:77` `fetch` not calling `reportTransportReachable`.** That is the lower-level
   deadline fetch used by uploads and plugin backends; the recovery report belongs to the request boundary
   that owns reachability semantics (`http.ts:51`). A plugin-backend 500 must not vouch for the machine link.
7. **Local plugin-backend successes not vouching for the local machine.** `pluginBackendRequestPath` uses the
   bare `"api"` prefix for local, so `machineIdFromUrl` yields undefined and a success vouches for `"page"`
   only — which is what `transportHealth.ts`'s comment documents ("not even the local one"). Consistent.
8. **`reportTransportReachable` firing before the status is judged** (`http.ts:48-51`): deliberate ("a 500 from
   it disproves 'the link is down' just as much as a 200 does") and harmless on its own. It is only misleading
   for the *gateway-proxied* 502, and that is reported as part of C1 rather than as a second defect.
9. **`machineActivitySubscriptionInputsChanged` (PiWebApp.ts:4010-4014) re-subscribing on every
   `machineStatuses` identity change.** Its consumer computes a desired `Set` of machine ids
   (`machineActivitySubscriptionIds`, :1971-1977) and diffs it against open sockets, so a fresh object
   identity costs a recompute, not a reconnect.
10. **`errorMachineId` going stale across a machine switch.** `selectMachine` spreads
    `resetWorkspaceScopedState()`, which includes `clearErrorPatch()` (`appState.ts:195`), so the banner and
    its scope are dropped together. C2's hazard is the *late* write after the switch, not a stale scope.
11. **`bannerShownAt` being refreshed on the hide path** (`PiWebApp.ts:1085-1090`) and `lastScheduledError`
    surviving a hold (`bannerHold.ts`). The hold delays *removal* only — a replacement (non-empty different
    text) always returns `{kind: "show"}` and swaps immediately; `heldErrorBanner` is reset by the show path
    (a render with `error === ""` assigns `null`). No re-show of a withdrawn message.

Also checked and clean: `kind-tone-*` is composed dynamically (`SessionTreeNavigator.ts:176`), all six tones
have rules; `.xterm-*`/`.cm-*` selectors style third-party internals deliberately
(`pi-web-plugins/terminal/xtermStyles.ts`, `PromptEditor.ts`); `Interrupted-run …` text matches no transient
rule, so it is never rewritten; the dead-CSS sweep's token-absence test is conservative (it can miss a class
used in another component's template, cannot report a live class as dead).

---

## Suggested fix order for the round

1. C1 (one expression + one test case) — restores the model's core promise for the commonest multi-machine failure.
2. C2 (one line, pattern already used twice in this repo).
3. C3 (needs a small model decision: how a notice declares it has no re-raise path behind it).
4. C4 + C5 together (hoist the literals; they are the same anti-pattern).
5. C6 (mechanical deletion; `AppNavigationPanel.ts:47` + `PiWebApp.ts:2216` + the 26 dead rules).
