# Round 24 — Lane C findings

HEAD `81d37fc0` ("Start convergence round 24"), branch `refactor/plugin-architecture`.
Read-only review. Scope: the banner-retirement model (notice.ts / errorNotice.ts / errorBanner.ts /
bannerHold.ts / transportHealth.ts / http.ts), PiWebApp error plumbing, `shared.ts` rail rules and
precedence, switcher-removal leftovers, docs-vs-code drift, and the pointer/query order guard.

Every finding below carries a failure scenario and an adjudication. `TRUE` = the defect is real.
Ordered by severity.

---

## F1 — TRUE / MEDIUM-HIGH — `reportTransportReachable` vouches for a machine from URLs the web process answers itself

**Where**
- `src/client/src/api/http.ts:47-50` — the report fires on every response, before the status is judged.
- `src/client/src/api/transportHealth.ts:25-28` — the docstring that states the rule.
- `src/client/src/api/transportHealth.ts:31` — `const scoped = /\/machines\/([^/]+)/.exec(url);`
- `src/client/src/components/PiWebApp.ts:998` — the wiring: `observeTransportRecovery((machineId) => { this.clearTransientError(machineId); });`
- `src/client/src/components/PiWebApp.ts:1042-1060` — `clearTransientError`.

**The stated rule** (transportHealth.ts:25-28):

> The machine a request URL speaks about; undefined for web-owned URLs, which prove the web process
> answered and nothing about any machine's link - **not even the local one, whose daemon can be down
> while the web process serves 200s.**

**What the code does.** `machineIdFromUrl` decides nothing about ownership; it returns the id from any
URL that contains `/machines/<id>`. But `/api/machines/local/…` is a *mixed* namespace — the web process
mounts its own services under that prefix:

| route | registered at | who answers |
| --- | --- | --- |
| `/api/machines/local/plugins` | `src/server/web/app.ts:250` | `piWebPlugins.plugins()` — web only |
| `/api/machines/local/config` | `src/server/web/configRoutes.ts:67,75` | `configService` — web only |
| `/api/machines/local/projects`, `…/workspaces` | `src/server/web/app.ts:73,257` | `ProjectService`/`WorkspaceCatalog` — web only |
| `/api/machines/local/pi-packages` | `src/server/web/app.ts:252` | web only |
| `/api/machines/local/health` | `pi-web-plugins/machines/server-plugin.ts:80-95` | web only, and answers **200 even when the machine is down** |
| `/api/machines/local/sessions`, `/terminals` | `src/server/web/app.ts:260,269` | proxied to sessiond |

So every web-owned local route is stamped as a vouch for the local daemon's link.

**Failure scenario A (a second route erases the claim).** The local session daemon dies.
`GET /api/machines/local/sessions` returns the proxy's 502 (`src/server/web/sessionProxyRoutes.ts:67`,
`Session daemon unavailable: connect ECONNREFUSED …`); `http.ts:62` stamps the `HttpError` with
`machineIdFromUrl(url)` → `"local"`; the text matches `unavailable: connect econnrefused` + `session daemon`
(`src/client/src/components/errorBanner.ts:66-70`) → transient → `noticeFromTransport(text, "local")`
(`src/client/src/notice.ts:101`) → a reply-retired claim scoped to `local`. The reader now browses files or
opens the plugin panel: `GET api/machines/local/projects` answers 200 from the web process's own catalogue,
the sessiond is still dead. `reportTransportReachable` → `"local"` → `errorMachineId === machineId` →
`clearErrorPatch()`. The daemon-down banner is withdrawn by a response that never touched the daemon, and
it does not come back until the next failing poll.

**Failure scenario B (the same response does both — no second route needed).**
`GET api/machines/<id>/health` is answered by `pi-web-plugins/machines/server-plugin.ts:80-95` with
`sendJson(reply, health)` — HTTP **200** — carrying `{ok: false, status: "error"|"offline", error: "…"}`
when the machine is unreachable (`pi-web-plugins/machines/server/machineService.ts:135` local,
`:148-150` remote). The reachability report fires on the way in; only afterwards does
`machineController.refreshMachineHealth` (`src/client/src/controllers/machineController.ts:123-131`) look
at `ok` and paint nothing. **The response that reports the machine unreachable is itself counted as proof
the machine is reachable.** The remote-route-restore ladder
(`src/client/src/components/PiWebApp.ts:1499-1528`) polls exactly this route on a timer; each attempt
clears the claim and `setRemoteRouteRestoreMessage` (`PiWebApp.ts:1541-1551`) re-plants it, so between
retry delays the screen says nothing is wrong while the machine is still down. Once the ladder exhausts
(`PiWebApp.ts:1532-1537`, "X is still unavailable.") nothing re-plants it, and the next health read from
any path (`PiWebApp.ts:2945`, `:3286`) deletes the exhausted banner permanently.

**Why the existing comment does not cover it.** `http.ts:47-49` justifies firing before the status check
with "a 500 from it disproves 'the link is down'" — true about the *web process*. The report is also used
to vouch for the *machine named in the URL*, and for `local` that is a different process (sessiond) than
the one answering. Two claims, one unconditional report.

**Fix directions.** Either (a) treat the web-owned machine-prefixed routes as page-scoped, so
`machineIdFromUrl` returns `undefined` for them — the docstring already asks for this; or (b) let the
response speak: suppress the vouch when a `/machines/:id/health` body says `ok:false`, and never let a
response whose own body is a transport claim vouch for that machine.

---

## F2 — TRUE / MEDIUM — the banner's identity is its *wording*, not its *claim*: one machine's expiry timer deletes another machine's banner

**Where**
- `src/client/src/components/PiWebApp.ts:3818-3824` — `if (error !== this.lastScheduledError) { … }`
- `src/client/src/components/PiWebApp.ts:1085-1086` — `if (this.state.error === error && this.state.errorRetiredBy === RetiredBy.reply) this.setState(clearErrorPatch());`

Everything else in this model is machine-scoped: `state.errorMachineId`, and `clearTransientError`'s own
comment at `PiWebApp.ts:1038-1041` — "The report vouches for one machine: a claim about machine B survives
a success from machine A." But the two identity tests above compare **text only**; neither looks at
`errorMachineId`, `bannerShownAt` or the schedule's owner.

**Failure scenario.** Machine A's poll exceeds its deadline → `"The server did not answer within 30s."`,
scoped `A`, reply-retired; `lastScheduledError` = that text; the expiry timer is armed at T+6000
(`TRANSIENT_ERROR_TIMEOUT_MS`). The reader switches to machine B. B is also down, and its socket never
opens, so `onConnected` → `clearTransientError` never runs and `lastScheduledError` is **not** reset. B's
poll times out with the identical wording → `error !== this.lastScheduledError` is false → no new hold
window, no new expiry timer, `bannerShownAt` unchanged. At T+6000 **A's** timer fires, the text still
matches, and B's claim is deleted although B never answered once.

This is the exact defect the neighbouring comment claims was fixed — `PiWebApp.ts:3818-3819`: "A
replacement starts its own hold window and its own expiry: borrowing the previous banner's timestamps gave
the new message a shorter life than the model promised" — and the exact one `PiWebApp.ts:1085` claims to
prevent: "Only clear what we scheduled for: a newer message must not be swallowed." Both sentences describe
an identity, and both are implemented against the wrong one. The same text re-raised while
`lastScheduledError` still holds it also inherits the previous claim's remaining `BANNER_MIN_VISIBLE_MS`
hold (`bannerHold.ts` via `PiWebApp.ts:3811`), so the second claim can be visible for under the promised
1.5 s.

**Fix direction.** Carry the schedule with the claim (`{text, machineId, shownAt}`) and compare all three,
or stamp the armed timer with the machine it was scheduled for and check `state.errorMachineId` at 1086.

---

## F3 — TRUE / MEDIUM — the QuickSwitcher's interrupted marker yields only to `working`, hiding amber and red, and uses a different predicate from the grouping it sits inside

**Where**
- `src/client/src/components/QuickSwitcher.ts:195-199` and the render at `:215`
- `src/shared/sessionActivityState.ts:31-38` (`sessionActivityCategory`)
- `src/shared/activity.ts:11-17` (`isSessionActive`)
- `src/client/src/quickSwitcher.ts:129-137` (grouping)

The comment states the rule:

> The moment the session works again the marker yields to the live state (**three dots / green / amber / red**).

The code: `const interrupted = this.interruptedSessionIds.has(session.id) && rawStateKind !== "working";`
— only `working` yields. `rawStateKind` comes from `sessionActivityCategory`, whose vocabulary is
`error | asking | working | background | idle`. So:

- An interrupted session now blocked on an `ask_user` question (`asking`) shows the amber
  "A restart interrupted this run" flag and **no state indicator at all** — `stateKind = undefined`
  (`QuickSwitcher.ts:199`) means `renderSessionRowIndicator` is never called at `:215`.
- Same for `activity.phase === "error"`: the red dot is deleted. Grouping puts that row in the **error**
  group, which `quickSwitcher.ts:131-133` describes as "An error stops the agent until someone intervenes,
  so it outranks even a question" — and then the row wears a stale restart flag instead of the error mark.
- "green" is named in the comment but does not exist in this vocabulary at all (`.session-state` has no
  success member; green belongs to `.activity-indicator.session`, which only machine/workspace rows wear).

The predicate split makes it worse. Grouping decides interrupted-ness with `sets.active`
(`quickSwitcher.ts:136`), fed from `isSessionActive` (`PiWebApp.ts:2339-2343`), while the marker decides it
with `sessionActivityCategory` (`PiWebApp.ts:2348-2350`). `isSessionActive` ignores `pendingAsk`,
`pendingDialogs` and `backgroundRunCount`; `sessionActivityCategory` treats them as `asking`/`background`.
Result: a session with a pending question is grouped under "waiting" (so grouping agrees it is not
interrupted) yet is marked interrupted. `PiWebApp.ts:2330-2337` says `activeSessionIds` was deliberately
built from the machine-wide list so that "grouping it under WORKING without a working badge would
recreate the divergence this code exists to avoid" — but the mark path consults a third predicate, so the
divergence is reproduced one file away.

Severity multiplier: QuickSwitcher rows are `class="row session-row"` (`QuickSwitcher.ts:203`), and the
component imports `interactiveSurfaceStyles` rather than `sharedStyles` (`QuickSwitcher.ts:16`), so the
state rail never paints them. The dot is the *only* state signal in that list, and this branch removes it.

---

## F4 — TRUE / MEDIUM-LOW — `.action-row.selected` repaints an asking or errored row blue, the exact "one thing up close, another at scanning distance" case the rail exists to prevent

**Where**
- `src/client/src/components/shared.ts:400-403` — the invariant.
- `src/client/src/components/shared.ts:446` asking → `--pi-warning`; `:448` error → `--pi-danger`;
  `:450` `.action-row.selected { border-left-color: var(--pi-accent); }` at (0,2,0).
- `src/client/src/components/SessionList.ts:405` — the `selected` class on the open session's row.
- `src/client/src/components/SessionList.ts:744` — `.action-row.bulk-selected { border-color: var(--pi-accent); }`.

The invariant as written: "the rail wears the very colour the row's own dot wears (running accent, asking
warning, unread purple), so a row **never** reads as one thing up close and another at scanning distance."
`.action-row.selected` is (0,2,0) and wins, so the row the reader currently has open — the row most likely
to be holding a question, because the reader is looking at it — shows an amber dot inside a blue rail. An
open session whose agent stopped on an error shows a red dot inside a blue rail. During a bulk selection,
`.bulk-selected` repaints every selected row accent, including asking and error rows.

`shared.ts:417-429` defends the *specificity mechanism* at length and never reconciles it with the urgency
colours; nothing in the file says "you are here" outranks "needs your answer". The CSS is clearly
deliberate, so this is an invariant/documentation defect with a real perceptual consequence: on a scan down
the list, an unanswered question in the open row is invisible, and blue is precisely the colour the design
uses for "work in progress".

**Fix direction.** Either narrow the sentence at `shared.ts:400-403` to name the selection exception, or
let selection keep the urgency colour (selection is already carried by `background` and `border-color`,
`shared.ts:356`) and drop the rail override for the urgency states.

---

## F5 — TRUE / LOW — `shared.ts:421` names a rule member the sheet does not contain, and the next sentence refutes it

> All `:has()` rules are (0,1,0) … and the row-class rules below (**unread**/archived/selected) are (0,2,0),
> so they win on specificity regardless of order. The unread CLASS is unconditional on a session row even
> when the arbiter's dot shows running or asking, so a row-class unread rule **would** paint those rows
> purple … the dot rules above are the only unread painters.

Below line 421 there are exactly two row-class rail rules: `.action-row.archived` (`:449`) and
`.action-row.selected` (`:450`). There is no `.action-row.unread` rail rule — the very next sentences explain
why it is absent. `.action-row.unread` does exist, but in `SessionList.ts:726`, and paints text weight only.
The last paragraph of the same comment does this correctly for the third co-owned rule ("SessionList's
`.bulk-selected` … which this sheet cannot see"); unread simply needs the same treatment instead of being
listed as a member of the set below.

---

## F6 — TRUE / LOW — `notice.ts:108-111` documents a branch that can never run, and it is the branch that would drop the machine scope

`src/client/src/notice.ts:103-104`:

```
if (isTransientError(text) || /failed to fetch|load failed|networkerror when attempting to fetch/i.test(text)) {
  return noticeFromTransport(text, error instanceof RequestTimeoutError ? machineIdFromUrl(error.url) : undefined);
}
```

`RequestTimeoutError`'s message is always "The server did not answer within Ns." and
`normalizeTransientError` matches `/did not answer within/i`
(`src/client/src/components/errorBanner.ts:84`), so `isTransientError(text)` is true for every instance and
line 104 always returns. Line 111 — `if (error instanceof RequestTimeoutError) return noticeFromTransport(text);`
— is **unreachable**, and it is the *unscoped* variant of the same call.

Two costs. (1) The five-line comment at `notice.ts:106-110` ("A deadline miss asserts 'the server did not
answer' … Measured live: a remote machine answered /status at 30.007s against a 30.000s browser deadline")
reads as the reason timeouts are reply-retired; the real reason is line 103. A reader auditing retirement
semantics lands on dead code. (2) If the timeout wording or that pattern ever changes, control reaches line
111 and the banner silently loses the machine scope line 104 exists to attach — a machine-scoped claim
becomes a `page` claim, which `clearTransientError` (`PiWebApp.ts:1049`) lets *any* machine's success erase.
That is the exact class of bug rounds 22-23 were fixing. Delete lines 108-111, or make 111 the scoped
authority and let 103/104 handle only non-deadline wording.

---

## F7 — TRUE / LOW — `ReportedError` is dead outside its own test

`src/client/src/controllers/reportedError.ts:13`. A `grep` over `src` for `ReportedError|reportedError`
returns only the definition and `src/client/src/controllers/reportedError.test.ts` (lines 3, 8, 14). Every
controller now calls `errorNoticePatch` / `noticePatch` / `clearErrorPatch` directly; the class is a wrapper
from the pre-`noticePatch` era. Its test is what keeps it — and any knip-style dead-export report — blind
to it. If it is kept deliberately as the controller-facing API, nothing imports it; if it is a leftover, the
test is the only thing that has to go with it.

---

## F8 — TRUE / LOW — the removed MachineSwitcher is still described as live code, with line-number citations

Removal itself is clean: no reference survives anywhere under `src/` or `pi-web-plugins/`, matching
`docs/design/research/r20-lane-a.md:115`. What was not removed is the documentation that points at it:

- `docs/design/research/plugin-declarative-contract.md:287` and `:304` — cites `MachineSwitcher.ts:39` as
  the reason a contract entry stays imperative ("焦点/外点关闭不可"). The most costly one: an architectural
  decision is justified by a file that no longer exists.
- `docs/design/research/uiux-r14-lane-b.md:10, 97, 115, 162, 165, 174` — including concrete citations
  (`MachineSwitcher.ts:123`) and an open finding about `.machine-switcher-button` min-height.
- `docs/design/research/r15-lane-a.md:27, 30` — cites `MachineSwitcher.ts:142` and its `hostUi.ts` adoption.
- `docs/design/research/uiux-r12-lane-c.md:99` — cites `MachineSwitcher.ts:302-305`.

---

## F9 — TRUE / LOW — the rail's precedence table, whose stated rule is "source order decides", has no test; and the pointer-order guard cannot see it

`shared.ts:396-450` carries three paragraphs of ordering history — "A previous draft put
`.session-state.running` in both rules; the later accent rule then overpainted every row the success
membership matched, so the membership never decided a colour and the table read as two colours for one
state." A `grep` for `border-left-color` / `action-row:has` / `session-state.asking` across all
`*.test.ts` returns nothing. The one table that depends on cascade order is the one with no pin, so a
harmless-looking reflow of those seven rules is invisible to CI.

`src/client/src/components/pointerQueryOrder.test.ts` — the guard that exists in this space — cannot cover
it, and has its own blind spots: its selector pattern only recognises `.class` / `#id` selectors (element
and attribute selectors pass ungated); it checks order within one `css` block, so a component that composes
`static override styles = [a, b]` in the wrong order — which is exactly how `interactiveSurfaceStyles` and
`sessionStateBadgeStyles` are assembled, `QuickSwitcher.ts:11,16` — is not seen; and its media-block regex
does not handle comma-separated `@media` lists.

---

## F10 — FALSE (near-miss, worth pinning) — `openLazySurface`'s "reader-retired" comment is correct

`src/client/src/components/PiWebApp.ts:1786-1805`. The comment at `:1800-1801` asserts "A module fetch
failure is a network-shaped error: reader-retired, which the success path's text match then retires on
retry." The wording invites the opposite reading, because the message contains "could not load" and
`noticeFromError`'s fallback regex (`notice.ts:103`) mentions "load failed". Checked against both
predicates: `normalizeTransientError` (`errorBanner.ts:50-104`) has no "could not load" rule and its
fetch-family rule is anchored to the whole message (`^(failed to fetch|load failed|…)[.]?$`), and the
unanchored fallback asks for "load failed", not "could not load". Both false → `noticeForReader`
(`notice.ts:112`). The comment holds, and the success path at `PiWebApp.ts:1793` is reachable.

Recorded because it is one word from flipping: adding "could not load" to the transient table would make
this banner auto-dismiss after `TRANSIENT_ERROR_TIMEOUT_MS` *and* be cleared by any unrelated 2xx, and would
silently make `PiWebApp.ts:1793` dead. A test pinning `errorNoticePatch(new Error(failure)).errorRetiredBy`
for that exact sentence is cheap insurance.

---

## F11 — FALSE — `connectRealtime`'s default `adoptEmpty: true` on machine change is correct

`PiWebApp.ts:2049` reuses the boot path when the reader switches machines. For a *different* machine that
call **is** its boot read, so adopting an empty snapshot is right; the stale-marker risk is closed at render
time by `interruptedSessionIdsMachine !== selectedMachineId(state) ? EMPTY_ID_SET : …`
(`PiWebApp.ts:3955`, set at `:787-788`). The two `{adoptEmpty: false}` call sites — reconnect (`:1948`) and
quick-switcher open (`:2481`) — are the intended exceptions, and both are places where an empty answer means
"not yet", not "none".

---

## F12 — TRUE but likely intended / LOW — `--pi-accent` is spent on a mark that means "unread"

`shared.ts:462` — `.unread-ring { … border: 1.5px solid var(--pi-accent); … }`, while every other unread
mark in the app is purple: the rail (`shared.ts:437`), `.activity-indicator.unread` (`shared.ts:460`), and
`.session-state.unread` (`sessionStateBadgeStyles.ts:36`). Accent is what this design uses for *running*
(`shared.ts:445`, `sessionRowIndicator.ts:19`). So a machine row that is unread and working reads as: green
rail, green work dot, wrapped in a **blue** ring — a three-colour composition for two facts, in which the
ring's own colour belongs to a state it is not reporting. The rail comment (`shared.ts:427-435`) explains
why the *rail* stays the work colour, but says nothing about the ring's. If "identity colour" is the rule,
`--pi-purple` on the ring keeps one meaning per hue; if the accent is deliberate contrast, that belongs in
the comment next to the other colour decisions.

---

## Verified clean (no finding)

- Switcher removal at the **code** level: no `MachineSwitcher` / `machine-switcher` reference survives in `src/` or `pi-web-plugins/`; `@query("machine-list")` resolves to the plugin-contributed element, and plugin rows adopt the host sheet via `pluginHostUi.ts:34-35`, so the rail and dot vocabularies come from one source.
- Every error site in `machineController.ts` and `sessionController.ts` goes through `errorNoticePatch` / `noticePatch` / `clearErrorPatch`; no producer writes `state.error` directly, so no producer can force a wrong `retiredBy`. `authController.ts:152,290` `error:` fields are dialog-local state, not the shared banner.
- The arbiter really does render one dot per row (`sessionRowIndicator.ts:65-72`), so no composite `:has()` membership collision exists in the rail table; `.session-state.running` (used by the rail at `shared.ts:445`) is a real rendered class, not a dangling selector.
- `.action-row.archived` / `.selected` are (0,2,0) and do override the (0,1,0) rail memberships, as the comment claims (see F4 for whether that *should* be true).
- `operation-model.md` claims check out against the code: `notice.ts:70`, `requestDeadline.ts:29`, and the `{live:false}` default in `noticeFromError` are all accurately described.
- HTTP 502 self-vouch (`reportTransportReachable` firing before `http.ts:51` throws) is self-correcting within one request: the throw re-raises the claim in the same microtask, before Lit renders. Semantically wrong, visually silent. F1 covers the case where it is *not* self-correcting.
- `pending-session-row` (`SessionList.ts:325`) genuinely lacks `.action-row`, matching the "Painted on the pending-session row, which has no rail" note at `shared.ts:452`.
- `errorNoticePatch` always stamps `errorMachineId: notice.machineId ?? "page"`, so a producer cannot smuggle a `reader-retired` claim into machine scope by handing over a bare `new Error()`.
