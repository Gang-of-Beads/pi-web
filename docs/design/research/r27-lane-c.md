# Round 27 — Lane C: banner retirement model, rail precedence, switcher leftovers, docs drift

Repo: `/Users/hanxiao.du/Desktop/vincent/projects/pi-web` · branch `refactor/plugin-architecture` · HEAD `591b37e7`
Read-only audit. Every line number below was re-read from the working tree with `sed`/`grep`/`awk`, not from a cached read.
`src/client/src/components/shared.ts` verified: 536 lines, md5 `408fdce49cab4e7ac1f7dcbf24c2474b`, identical to `git show HEAD:...`.

Verdict summary: **13 TRUE findings (1 High, 4 Medium, 8 Low), 9 adjudicated FALSE**.

---

## TRUE findings

### C1 — TRUE / HIGH — a plugin-backend link failure is mislabelled as an answer, so it becomes a permanent red banner

`src/client/src/api/pluginBackends.ts:72`

```ts
} catch (error) {
  throw new HttpError(`Plugin backend request unavailable: ${describeError(error)}`, 0, target.machineId);
}
```

When `fetch` rejects, the browser throws `TypeError("Failed to fetch")` (Chrome) / `TypeError("Load failed")`
(Safari). This wrapper composes that phrase into a longer sentence and re-throws it as an `HttpError`.

Round 26 put the transport phrase table in `errorBanner.ts:50` (`normalizeTransientError`) behind
`isTransientError()`, and `notice.ts:100-101` asks that table to decide the lifetime:

```ts
if (error instanceof HttpError) {
  return isTransientError(text) ? noticeFromTransport(text, error.machineId) : noticeForReader(text);
}
```

The rule that recognises a dropped connection is **anchored to the whole message**
(`errorBanner.ts:95`):

```ts
if (/^(failed to fetch|load failed|networkerror when attempting to fetch resource)[.!]?$/i.test(error))
```

`"Plugin backend request unavailable: Failed to fetch"` has a prefix, so the anchored match fails. The five
other rules also fail (rule 68 needs `unavailable: connect ENOENT`; rule 101 needs a leading
`remote machine …`). Therefore:

* `isTransientError(...)` → `false`
* `noticeFromError` → `noticeForReader(text)` — **`retiredBy: "reader"`, and `noticeForReader`
  (`notice.ts:38`) drops `error.machineId` entirely**, so `errorMachineId` becomes `"page"`.
* `scheduleTransientErrorDismissal` (`PiWebApp.ts:1096`) returns early because
  `normalizeTransientError(error) === undefined`, so there is no 6-second expiry either.
* `errorBanner.ts:23` leaves `transient` undefined, so it renders the permanent red `role="alert"` style
  with the raw composed string as its text.

Net effect: a phone that slept, a browser that refreshed mid-flight, or a web process that restarted during a
plugin-backend call puts **"Plugin backend request unavailable: Failed to fetch"** on screen in the permanent
failure style, where it survives every subsequent successful poll on every machine, until the reader clicks
the ✕. That is exactly the "red bar over an app that is working fine" failure mode the round-26 changeset
claims to have closed.

Note the sibling paths are correct, which is what makes this a conversion gap rather than a design
disagreement:

* a `RequestTimeoutError` caught on the same line composes to
  `"…: The server did not answer within 30s."`, and rule `errorBanner.ts:84` is *unanchored*, so it matches →
  reply-retired, 6s expiry. Works.
* `pluginBackends.ts:70` correctly passes `{ machineId: target.machineId }` to `reportTransportReachable`, and
  line 72 correctly stamps `target.machineId` on the `HttpError` — both half of the round-26 per-machine model
  were implemented here. Only the *lifetime* half is broken, and it is broken by the message shape.

Two candidate fixes, both local: emit the bare `describeError(error)` and carry the operation in a separate
field, or have `normalizeTransientError` strip a known `"<prefix> request unavailable: "` head before the
anchored family match. Either way the anchored rule and the composed-message rule
(`errorBanner.ts:60-64`, `composed = /is unavailable; reconnecting/i`) need to agree on one vocabulary for
"the wrapper names a scope, the tail is a transport claim"; today they recognise two different prefixes.

### C2 — TRUE / MEDIUM — the archetypal link failure is page-scoped, so `clearTransientError`'s per-machine vouch does not apply to it

`src/client/src/notice.ts:107-108`

```ts
if (isTransientError(text)) {
  return noticeFromTransport(text, error instanceof RequestTimeoutError ? machineIdFromUrl(error.url) : undefined);
}
```

Machine scoping is granted to `RequestTimeoutError` and to `HttpError` (line 101, `error.machineId`) — but not
to a bare `TypeError`, which is the single most common link failure a browser produces. Every fetch that goes
through `fetchWithDeadline` directly rather than through `http.ts`'s `request()` produces exactly that shape.

`PiWebApp.ts:1055-1059` documents the vouch:

```ts
// A page-level claim is disproved by any response from the origin; a
// machine-scoped claim only by a response that was routed to that machine.
const disproved = this.state.errorMachineId === "page" || this.state.errorMachineId === machineId;
```

So a "Failed to fetch" against remote machine B is stamped `"page"`, and the next successful request to
machine A — or to a third-party plugin manifest (see C9) — withdraws the complaint about B. The changeset for
this round's model states the opposite promise: *"recovery is now vouched for per machine: a success from
machine A no longer erases machine B's complaint."* The claim is true for gateway-named `HttpError`s and for
deadlines, and false for the transport failure it was probably written for.

There is no reason the `TypeError` case cannot be scoped: the throw sites know the URL. `noticeFromError`
simply never asks, because a `TypeError` carries no URL. Either the producer must stamp scope (as
`pluginBackends.ts:70` already does on the success path) or the model's claim must be narrowed in the
changeset to "scoped whenever the failure carried a scope".

### C3 — TRUE / MEDIUM — `noticeFromError`'s `link` parameter is dead, and its doc block documents behaviour that cannot happen

`src/client/src/notice.ts:68-80`, `src/client/src/errorNotice.ts:23-27`

```ts
export function noticeFromError(error: unknown, link: { readonly live: boolean } = { live: false }): Notice {
  if (error instanceof RequestTimeoutError && link.live) return NO_NOTICE;
```

Exhaustive caller list (65 `errorNoticePatch(` sites, all `noticeFromError` callers, all tests):

* the only non-test caller is `errorNotice.ts:27`, which forwards its own `link`
* `errorNoticePatch`'s default is `{ live: false }` (`errorNotice.ts:25`)
* no production call site and no test passes a second argument at all — `grep -rn "errorNoticePatch([^)]*,"`
  returns only object-spread forms (`{ ...errorNoticePatch(error), … }`)
* `grep -rn "live: true\|{ live"` across `src/` finds only the two default-parameter declarations above

So `notice.ts:80` never fires, and the docblock at `notice.ts:68-78` — *"A deadline miss therefore raises
nothing here while the socket is proven live; only a link that cannot be shown alive still speaks for the
page"* — describes a branch that is unreachable. Worse, the block at `notice.ts:110-115` contradicts it two
screen-lengths later: *"A deadline miss reaches the transport branch above: its fixed text … is exactly what
the wording table matches, so the deadline claims a reply lifetime."* Both statements cannot be the rule;
only the second one is operative.

This is not cosmetic. Round 26's plan explicitly made the deadline claim self-retiring
(`.changeset/timeout-banner-self-retires.md`), and this is the leftover suppression seam from the model that
came before it. `errorBanner.test.ts` and `notice.test.ts` pin the *operative* behaviour
(`notice.test.ts:72` asserts a deadline retires on reply), so the dead branch is invisible to CI — a
regression that re-suppressed deadline notices would pass every test in the repo.

### C4 — TRUE / MEDIUM — `onToggleSessions` is unreachable wiring; the `sessions` collapse state cannot be changed from the UI

`src/client/src/components/appShell/AppNavigationPanel.ts:172`, `:239`, `:358`, `:371-373`;
`src/client/src/components/PiWebApp.ts:2276`, `:2284`; `src/client/src/components/SessionList.ts:273`

Both and only both call sites hardcode the parameter off:

```ts
172:  ${this.renderSessionList(false, visible !== "sessions")}   // desktop render path
239:  ${this.renderSessionList(false, visible !== "sessions")}   // compact render path
358:  private renderSessionList(collapsible: boolean, hidden = false) {
371:        .collapsible=${collapsible && this.collapsible}
373:        .onToggleCollapsed=${() => { this.onToggleSessions?.(); }}
```

`collapsible === false` ⇒ `SessionList.ts:273` (`if (!this.collapsible) { … }`) takes the early branch and the
`section-toggle` button at `SessionList.ts:288` never renders. Note that `PiWebApp.ts:2267` *does* set
`.collapsible=${true}` on `AppNavigationPanel`, so `this.collapsible` is true; the wire is cut one level down
by the literal `false`.

Consequences, all live:

* `PiWebApp.ts:2284`'s `() => { this.navigationSections.toggle("sessions"); }` can never run, so
  `NavigationSectionsController`'s `sessions` slot has no producer.
* `PiWebApp.ts:2276` still feeds `.sessionsCollapsed=${this.navigationSections.isCollapsed("sessions")}`, and
  `compactVisibleSection():264` still reads it as a ranking input. The shell therefore ranks the sessions
  section by a piece of state that is pinned at its default (`navigationState.ts` default `false`) forever.
  `sessionsCollapsed` is effectively a constant that is threaded through three files.
* `.collapsed=${collapsible ? this.sessionsCollapsed : false}` at `:372` is likewise permanently `false`.

Either the two literals should be `true` (restoring the toggle), or the `collapsible` parameter,
`onToggleSessions`, `onToggleCollapsed`, `sessionsCollapsed` and the `sessions` member of the
`NavigationSection` collapse enum should all go — the second option is the honest one if the design has moved
to "the panel shows one section, no per-section toggles", because today the code claims a control that does
not exist.

### C5 — TRUE / LOW — `bannerHoldTimer` is the one timer `disconnectedCallback` forgets

`src/client/src/components/PiWebApp.ts:411`, `:3854-3855`, `:1114-1149`

`disconnectedCallback` clears `transientErrorTimer` (line 1116), `piWebStatusTimer` (1135),
`workspaceDeletionPollTimer` (1138), `livenessTimer` (1141) and calls
`clearScheduledPiWebStatusRefresh()` (1137) — 13 teardown steps in total. `bannerHoldTimer`, armed at line
3855, is not among them; `grep -n bannerHoldTimer` yields only the declaration (411) and the two arm/clear
sites inside `renderErrorBanner` (3854, 3855).

The timer body calls `this.requestUpdate()` on a detached element. The window is bounded at
`BANNER_MIN_VISIBLE_MS = 1500` (`bannerHold.ts:1`), so this is a leak rather than a bug — but this element
clears every other timer by name, so the omission is an inconsistency in a house rule, and re-connecting the
same element within the window means the stale hold fires against a freshly-reset `bannerShownAt`. One line
next to 1116 closes it.

### C6 — TRUE / LOW — `BannerHoldDecision`'s `show.text` field is never read

`src/client/src/components/bannerHold.ts:4,13` vs `src/client/src/components/PiWebApp.ts:3852-3861`

```ts
| { kind: "show"; text: string }              // bannerHold.ts:4
if (state.next !== "") return { kind: "show", text: state.next };   // :13
```

The only consumer destructures `decision.kind` and `decision.retryInMs` only; the `"show"` arm is a fall-through
(`PiWebApp.ts:3852-3857`) and line 3861 onwards uses the caller's own `error` variable. `text` is therefore a
second copy of a value the caller already holds — a small purity smell in a module whose entire purpose is to
be a pure three-state classifier, and the kind of duplicated truth that later drifts out of agreement with
the arm it mirrors. Drop the field, or make the caller use it.

### C7 — TRUE / LOW — `"sending"` is a dead member of the plugin's `ActivityIndicatorKind` union

`pi-web-plugins/machines/browser/activityBadge.ts:8,18-24`; `src/client/src/components/shared.ts:462`;
`src/client/src/components/SessionList.ts:325`

`ActivityIndicatorKind = "session" | "terminal" | "sending"`, and its docblock says *"call sites resolve
precedence (sending > session > terminal) before rendering"*. But the only function in the plugin package that
produces a kind, `statusActivityKind`, returns `"session"`, `"terminal"` or `undefined` — never `"sending"` —
and neither `MachineList`, `ProjectList` nor `WorkspaceList` ever passes `"sending"` to
`renderActionActivityIndicator`. The one place that emits `.activity-indicator.sending` hand-writes the span:
`SessionList.ts:325`.

So the shared sheet paints a class (`shared.ts:462`, amber) that no plugin in the repository can ask for, and
the plugin contract advertises a state its own classifier cannot produce. The style rule itself is *not*
orphaned — `SessionList.ts:325` produces it, and the accompanying comment at `shared.ts:461`
("Painted on the pending-session row, which has no rail") is accurate, because
`SessionList.ts:323` uses `pending-session-row`, not `action-row`. The dead part is the union member and the
docblock's promise about it.

### C8 — TRUE / LOW — the rail does not in fact "wear the exact colour the row's own dot wears": idle rows have a gray dot and no rail

`src/client/src/components/shared.ts:396-458`; `src/client/src/components/sessionRowIndicator.ts:57,71`;
`.changeset/banner-retirement-model.md` (last paragraph); `shared.ts:403-404`

The invariant is written down twice, in the sheet's own header comment and in this round's changeset:

> The state rail now wears the exact colour the row's own dot wears - running blue, asking amber, unread
> purple - so a row reads as one state at any distance.

Rendering `sessionRowIndicator` at `sessionRowIndicator.ts:57` returns `{ kind: "idle" }` for a finished
session, and `renderSessionRowIndicator:71` emits `<span class="session-state idle">`, styled gray at
`sessionStateBadgeStyles.ts:30`. The rail block covers `unread`/`background` (439), `activity-indicator.session`
(461… rule at 446), `running` (447), `asking` (448), `terminal` (449), `error` (450) and
`machine-status.offline/.error` (456) — **there is no idle rule**, so an idle row keeps the transparent
default from line 409 while its dot is gray.

Machine rows diverge the same way: `MachineList.ts:147` renders `machine-status online`, for which rule 456
covers only `.offline` and `.error` (the `MachineStatus` union at `src/shared/apiTypes.ts:75` also admits
`"online"` and `"unknown"`), and `activityBadge.ts`'s `markKind` fallback renders
`.activity-indicator.idle`, which also has no rail rule.

Defensible on design grounds — "done = nothing in flight" argues for spending no colour, and the sidebar is
calmer for it — but then the sentence that states the invariant is wrong, and it is stated as an absolute
("the exact colour", "the very colour"). Either add the idle membership to a gray rail rule, or narrow both
sentences to name the six states that do paint. Left as-is, the next reader who trusts the comment will
"fix" idle and quietly put a gray edge down every list on screen.

### C9 — TRUE / LOW — a third-party plugin-manifest fetch is treated as proof that PI WEB's own link is up

`src/client/src/plugins/external.ts:81-83`

```ts
const response = await fetchWithDeadline(manifestUrl, { cache: "no-store" });
reportTransportReachable(manifestUrl);
```

`manifestUrl` is an external plugin's own URL — a different origin from the app. The report reaches
`PiWebApp`'s `clearTransientError` with `machineId === undefined`, and line 1059 clears **any** page-scoped
reply-retired claim on it. A CDN answering for a manifest is not evidence that the machine behind a
"Lost connection to PI WEB" banner has come back.

The same call is also a latent scope-poisoning hazard: `machineIdFromUrl` (`transportHealth.ts:31`) matches
`/\/machines\/([^/]+)/` against whatever string it is handed, so a manifest URL that happens to contain a
`/machines/<x>/` path segment reports vouching for a machine called `<x>`.

`reportTransportReachable`'s contract (`transportHealth.ts:42-48`) says "the machine the URL was routed to";
a URL that was not routed to PI WEB at all does not satisfy that contract. An explicit
`{ machineId: "page" }`-with-no-clear, or dropping the call, is the honest fix.

### C10 — TRUE / LOW — `pi-web/status` is the one local route whose success cannot vouch for the local machine

`src/client/src/api/clients.ts` (`piWebStatusUrl`), `src/server/web/app.ts:241`,
`src/client/src/api/transportHealth.ts:30-32`

Local machine traffic is routed through `machinePrefix()` (`src/client/src/api/sockets.ts:22`) as
`api/machines/local/...`, so `machineIdFromUrl` returns `"local"` for it and local claims are scoped and
cleared correctly. But the status readout is federated at `/api/pi-web/status` with no `/machines/` segment
(confirmed at `app.ts:241` and `src/shared/federatedRoutes.ts:35`), so `machineIdFromUrl` returns
`undefined` for it and a success there only clears `"page"` claims. A `"local"`-scoped reply claim therefore
survives a successful local status poll.

Narrow, and mitigated twice over — any `api/machines/local/...` response clears it, and the realtime socket
reconnect callback at `PiWebApp.ts:1963` calls `clearTransientError(machineId)` independently — hence Low.
The docblock at `transportHealth.ts:24-29` actually *intends* this ("undefined for web-owned URLs, which
prove the web process answered and nothing about any machine's link — not even the local one"), so the
behaviour is designed; what is missing is that the local machine's status route is the only local-surface
route that falls into that category, which makes it look like an oversight when reading the client.

### C11 — TRUE / LOW — dead selector: `.workspace-label-base` has no producer anywhere

`src/client/src/components/shared.ts:175`, `:493`, `:499`

The class appears only in these three selector lists. The producers are
`pi-web-plugins/workspaces/browser/workspaceLabel.ts:9,13,15` and `WorkspaceList.ts:216,334`, which emit
`workspace-label`, `workspace-label-item`, `workspace-label-render`, `workspace-label-link` and
`workspace-label-separator` — never `-base`. Three membership lists (including the detail-row override at
499) are maintained for a class nothing renders. This is exactly the shape `dotScale.test.ts` and the
mark-language guard exist to catch, but neither scans this block.

### C12 — TRUE / LOW — `docs/capability-map-draft.md` still cites the deleted `MachineSwitcher.ts`, and its surviving citations have drifted

`docs/capability-map-draft.md:54`, `:231`, `:242`, `:247`

`MachineSwitcher.ts` was deleted in `b0bce2a0` (per `.changeset/banner-retirement-model.md` and
`docs/design/research/r18-lane-a.md:37`), and `find src pi-web-plugins -name 'MachineSwitcher*'` is empty.
Still cited as live code:

* `:54` "Remove machine … `C:components/MachineSwitcher.ts:116`"
* `:231` "`min-height: 60px`, own grid … `C:components/MachineSwitcher.ts:303,309`"
* `:242` "…delete the QuickSwitcher 240/140 pair and the MachineSwitcher 140/6px pair"
* `:247` "Exact violations to fix against those rules: … `MachineSwitcher.ts:303,309` (third grid)"

This is the fourth consecutive round to file it (`r21-lane-a.md:40-41`, `r23-lane-c.md:150,153`,
`r24-lane-c.md:236-247`, `r25-lane-b.md:76-81`); rounds 21 and 25 each recorded a commit message claiming
"the capability map … now point[s] at what exists", and in each case the edit changed the prose column and
left the `file:line` anchors.

The rows that *were* repaired have since drifted again, which is the new part of this finding:

| Map citation | Intended target | Actual line today |
|---|---|---|
| `MachineList.ts:181-184` (Add machine) | `renderAdd()` | `MachineList.ts:196-198` |
| `MachineList.ts:160` (Check again) | menu item | `MachineList.ts:179` |
| `MachineList.ts:163` (Open PI WEB) | menu item | `MachineList.ts:181` |
| `MachineList.ts:165` (Remove) | menu item | `MachineList.ts:182` |
| `MachineList.ts:125-127` (status/health + dot) | row meta | `MachineList.ts:147` |
| `MachineList.ts:227-234` (Rename) | `promptRename` | `MachineList.ts:229` (the row menu item is at 180) |
| `SessionList.ts:290` (Clean up) | cleanup heading | heading button is at `SessionList.ts:310-311`; 290 is `renderUnreadCount` |

A `file:line` table that is wrong by ~17 lines on every row of one component is worse than no table, because
it reads as authoritative. Either regenerate the MACHINE block or drop the line numbers and keep the
`file:symbol` form.

### C13 — TRUE / LOW — three design docs still describe the deleted switcher as a current owner of code

* `docs/design/machines-axis-plugin-design.md:16` — the "插件所有（pi-web-machines，runs:"web"）" inventory
  lists `MachineList/MachineSwitcher/SettingsMachinesPanel/SettingsFleetSection` as what the plugin owns
  today. Three of four exist.
* `docs/design/machines-workspaces-extraction.md:156` — "**Client moved-set**: `MachineList` and
  `MachineSwitcher` move as the …" — written in the present tense about a file that no longer exists.
* `docs/design/phone-navigation-model.md:36` — "(machine list gated on an expand nothing sets;
  `machine-switcher` rendered …)" — describes the custom element as rendered. It is not rendered anywhere;
  the element registration is gone, not merely hidden.
* `docs/design/review-triage-activity-split-redblue.md:18` lists `MachineSwitcher:6` among the live consumers
  of `activityBadge.ts`, which constrains a split decision that is presumably still open.

Contrast with `docs/design/research/*`, where the same name is a correct record of the facts at the time of
writing (round 23 already drew this line). The four above are not research notes — they are the documents
people read as current contracts.

---

## Adjudicated FALSE (checked this round, not defects)

**F1 — `shared.ts` has 9 rail rules including a `permission-needed` one.** FALSE. There are **7** `:has()`
rules — `shared.ts:439, 446, 447, 448, 449, 450, 456` — plus two non-`:has()` row-class overrides at 457
(`.archived`) and 458 (`.selected`). `permission-needed` is absent from the entire repository: `grep -rn` over
`src`, `pi-web-plugins`, `server`, `docs`, `.changeset` returns zero hits. It was replaced by
`.action-row:has(:where(.session-state.asking))` at line 448, and the naming law that retired it is recorded
at 440-445.

**F2 — `.action-rail` is a dead class / missing rail element.** FALSE — it does not exist, and never did in
this HEAD. The rail is `border-left` on `.action-row` itself (`shared.ts:409`), and the comment at 413-415
records precisely that the earlier draft which put it on the borderless `.action-main` "painted nothing at
all". No `::before`, no wrapper element, nothing orphaned.

**F3 — `has-activity` is leftover dead code.** FALSE. Zero matches repo-wide. Not a leftover — it is not in
this history at all; the wrapper class is `.action-activity` (`shared.ts:393`), which is produced by
`activityBadge.ts:41-43` and consumed by `.action-activity .unread-ring` at 475. The earlier suspicion came
from a stale cached read of `shared.ts`.

**F4 — `railStyles.test.ts` was deleted or never written.** FALSE / moot. The file does not exist in the tree
and no test references it; rail precedence is instead pinned indirectly by the specificity argument written
into the comment at 410-432, and the marks guards (`dotScale.test.ts`, `idleMarkHonesty.test.ts`) cover the
dot side. Worth noting as a *coverage* gap for the source-order-equals-precedence claim, not as a defect.

**F5 — `reportTransportReachable`'s `scope` parameter is unused.** FALSE. `pluginBackends.ts:70` passes
`{ machineId: target.machineId }`, and it is load-bearing: for `machineId === "local"` the request path is
`api/plugin-backends/...` with no `/machines/` segment (`pluginBackends.ts:36-38`), so URL derivation alone
would return `undefined`.

**F6 — `@keyframes pulse` is referenced but never defined, so the activity indicator is frozen.** FALSE.
Defined at `shared.ts:500` (and independently in `ChatView.ts:440`), inside the same `listStyles` block that
declares the animation at 395, so the pair survives the `adoptedStyleSheets` hand-off to plugin shadow roots.

**F7 — an exhausted / unshortenable reply-retired banner should have been auto-dismissed and is not.** FALSE
by design, and the design is written down. `scheduleTransientErrorDismissal:1096` declines to arm a timer
when `normalizeTransientError(error) === undefined`, and the block at 1088-1094 says exactly why: a
reply-retired message the wording layer will not shorten "asserts a state, renders with the permanent style,
and stays until its machine's answers or the reader retire it - expiring it contradicted its own rendering".
`"X is still unavailable. <detail>"` matches none of the six patterns, so it has no 6s timer and stays until
the machine answers. Correct, and the display style and the lifetime agree.

**F8 — `heldErrorBanner` can replay stale content during a hold.** FALSE. The hide path produces
`errorBanner("", "", retiredBy)`, and `errorBanner.ts:22` returns `null` for the empty string, so line 3867
sets `heldErrorBanner = null`; a subsequent hold decision at 3856 returns `null` and renders nothing. No
leak.

**F9 — local machine operations are unscoped, so local failures are cleared by unrelated successes.**
Largely FALSE. `machinePrefix()` (`sockets.ts:22`) emits `api/machines/local/...` and the
`/\/machines\/([^/]+)/` pattern matches the literal `local`, so every session, prompt and workspace operation
for the local machine vouches for `"local"` correctly. The only exception is the status route — see C10.

---

## Confirmed clean (negative results worth recording)

* **Switcher removal is complete at the code level.** `MachineSwitcher` / `machine-switcher` appear in
  `CHANGELOG.md`, `.changeset/*`, `dist/*.d.ts` and `docs/**` only. Zero hits in `src/**` and
  `pi-web-plugins/**` sources, no `customElement("…switcher")` registration, and
  `@query("machine-list")` resolves to the element the plugin actually contributes. The only leftovers are
  prose (C12, C13).
* **No `setState({ error: … })` bypasses remain.** Every producer routes through `errorNoticePatch` /
  `noticePatch` / `clearErrorPatch`, so the `{error, errorRetiredBy, errorMachineId}` triple cannot be set
  apart — the whole point of `errorNotice.ts:20-21`.
* **Rail specificity model is sound.** All seven `:has()` rules are `(0,1,0)` because their members are
  wrapped in `:where()`; `.action-row.archived` and `.action-row.selected` are `(0,2,0)` and therefore win
  regardless of source order, exactly as the comment at 410-423 claims. Rule 456 is deliberately placed after
  439 so machine health outranks unread on a row that is both — and that placement is what makes
  `MachineList.ts:159` (offline/error forces `kind = undefined`, so `markKind` degrades to
  `"unread" | "idle"`) render a danger rail rather than a purple one. Consistent with the code.
* **The unread-class comment at 423-427 is accurate.** `SessionList.ts:405` appends `${unread ? "unread" : ""}`
  unconditionally, and rule 439's unread membership keys on `.session-state.unread`, not on the row class —
  so an unread-and-running row wears an accent rail, not a purple one, which is the behaviour the comment
  says round 18 went out of its way to preserve.
* **`adoptedStyleSheets` ordering is safe.** `MachineList.ts:64-66` calls `super.createRenderRoot()` first
  (which is where Lit's `adoptStyles` *assigns* `renderRoot.adoptedStyleSheets`, see
  `node_modules/@lit/reactive-element/development/reactive-element.js:567` and `css-tag.js:105-107`) and only
  then appends the host sheets (`hostUi.ts:36-40`). Net order is `[element static styles, surfaceStyles,
  listStyles]`, so host rail rules reach plugin shadow roots and host rules win ties against plugin-local
  rules of equal specificity. The rail and dot vocabularies are genuinely single-sourced.
* **No direct socket reconnect path was orphaned by the new model.** `PiWebApp.ts:1963` still calls
  `clearTransientError(machineId)` on realtime connect, giving machine-scoped claims a second, independent
  withdrawal route alongside HTTP vouches.
* **`.session-state.sending` is not a dead rail rule** — there is no such rule. The arbiter maps
  `stateKind === "sending"` onto `kind: "running"` (`sessionRowIndicator.ts:53`), so session rows never render
  that class, and no CSS claims to. The amber "sending" mark lives only in the
  `.activity-indicator` vocabulary (`shared.ts:462`), produced by `SessionList.ts:325`. See C7 for the part
  that *is* dead.
