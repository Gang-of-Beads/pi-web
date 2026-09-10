# Round 28 — Lane C (read-only audit)

Repo: `/Users/hanxiao.du/Desktop/vincent/projects/pi-web` · branch `refactor/plugin-architecture` · HEAD `161a44dd` ("Start convergence round 28"; round 27 fix was `a5d3f390`).
No files were edited. Scope: banner retirement model, transport-reachability vouching, rail/dot palette, MachineSwitcher leftovers, docs-vs-code drift, producer discipline.

**Bottom line: 4 TRUE findings (1 functional-and-losing, 1 functional-but-narrow, 2 doc drift), 4 FALSE (verified clean).**
The retirement model itself (`notice.ts` / `errorNotice.ts` / `renderErrorBanner` / `bannerHold`) holds up. The leak is one layer down: **`reportTransportReachable(url)` reads a URL as "that machine answered", but a large share of machine-namespaced URLs are answered by the web process without the machine ever speaking** — including answers whose payload says the machine is *down*.

---

## F1 — TRUE (functional, claim destroyed while the machine is still down)
**A machine-namespaced URL that the web process answers is treated as that machine's proof of life, and deletes a reply-retired claim about that machine.**

Chain, with file:line:
1. `src/client/src/controllers/machineController.ts:186-195` — `safeRemoteHealth` calls `api.health(machine.id)`.
2. `src/client/src/api/clients.ts:124` — that is `api/machines/<id>/health`.
3. `pi-web-plugins/machines/server-plugin.ts:83` + `pi-web-plugins/machines/server/machineService.ts:105,139-152` — this is a **web-process plugin route**; `remoteHealth()` swallows `ECONNREFUSED` and returns `{ ok:false, status:"offline" }` as **HTTP 200**. `/health` and `/runtime` are not in `src/shared/federatedRoutes.ts`, so nothing proxies them to the machine. Same shape for the local machine: `machineService.ts:100-137` `localHealth()` answers `200 ok:true` with `sessiond:"offline"`.
4. `src/client/src/api/http.ts:48-50` — `reportTransportReachable(url)` fires on every response, before the status is judged, and no scope is passed.
5. `src/client/src/api/transportHealth.ts:30-31` — `machineIdFromUrl` extracts `"<id>"` from `/machines/<id>/`, so this web-process answer "vouches" for `<id>`.
6. `src/client/src/components/PiWebApp.ts:1055-1061` — `clearTransientError("<id>")` treats the claim as disproved (`errorMachineId === machineId`, `retiredBy === reply`) and deletes it.
7. `machineController.ts:118-124` / `204-208` — the health path that succeeded **does not re-raise**: on a resolved value it only writes `machineStatuses`, never inspecting `ok`.

Failure scenario (reproducible, no race needed):
- Fleet has a remote machine "lab mac"; it is powered off. The reader opens a deep link to it (or selects it).
- `loadMachines` (`machineController.ts:14-34`) → `selectInitialMachine` → health **200 `{ok:false}`** → `noticePatch(noticeFromTransport("lab mac is unavailable; reconnecting…", "lab-mac"))` (`machineController.ts:181`). Correct per the model: reply-retired, machine-scoped, and *deliberately non-expiring* — the wording table declines to shorten composed messages, so `scheduleTransientErrorDismissal` (`PiWebApp.ts:1095-1096`) arms no timer. Its documented promise is "stays until its machine's answers or the reader retire it".
- One line later the same method fires `void this.refreshMachineHealthFor(machines)` and `refreshMachineRuntimeFor(machines)` (`machineController.ts:27-28`) → `api/machines/lab-mac/health` and `/runtime`, **both web-process 200s, both addressed to `lab-mac`** → step 4-6 → the claim is deleted. `Promise.allSettled` + fulfilled-only harvesting (`machineController.ts:204-213`) means nothing re-asserts.
- Net: the reconnect banner flashes for one round trip and vanishes while the machine is still off. `MachineHealth.ok === false` is sitting in the very body whose arrival was counted as proof of life. The reader's only remaining signal is the offline dot on a different surface.

Local twin of the same bug: `machinePrefix` defaults to `"local"` (`clients.ts:77`), so `api.projects`, `config`, `plugins`, `pi-packages`, `health`, `runtime` all live under `/api/machines/local/…` and all are served by the web process — `src/server/web/app.ts:250-271` registers `registerLocalProjectRoutes(..., "/api/machines/local")` and the plugin/config routes without ever contacting `sessiond`. A successful projects load therefore "proves the local machine's link is up" while its daemon is down. (Local claims happen to carry a 6s expiry, so the visible damage there is small; the remote composed claim above has none, which is why this is not cosmetic.)

Note the code contradicts its own contract: `transportHealth.ts:26-29` says web-owned URLs "prove nothing about any machine's link — **not even the local one, whose daemon can be down while the web process serves 200s**". The extractor only recognises a machine by the `/machines/` segment, so exactly those web-owned local routes are not recognised as web-owned.

Fix seam already exists: `reportTransportReachable(url, scope)` accepts an explicit `machineId`; `fetchBody` also has `response.ok` and `HttpError.machineId` in hand. A vouch needs (a) `response.ok`, and (b) evidence the route actually traversed to the machine (proxied route set, or a server-stamped header) — not the URL's prefix.

Adjudication: **TRUE.** Functional, deterministic, and it defeats the round-22/25 "only that machine's answers can retire that machine's claim" guarantee from the opposite direction — not machine A speaking for machine B, but the web process speaking *for* B.

## F2 — TRUE (functional, narrow): a gateway-authored 5xx is counted as the machine's answer
`http.ts:48-50` documents the intent: "a 500 from it disproves 'the link is down' just as much as a 200 does". That is right for the browser↔web hop and wrong for the web↔machine hop, which is the hop a machine-scoped claim is about. `src/server/web/sessionProxyRoutes.ts:70-73` answers `502 {error:"Session daemon unavailable: connect ECONNREFUSED …"}` for `app.all("/api/machines/local/status")` (`sessionProxyRoutes.ts:45`), and `src/server/web/machineProxyRoutes.ts:365-374` does the equivalent for remotes — in both cases the status code is **invented by the web process to announce the machine's absence**, yet it is reported as that machine being reachable.

Failure scenario: reader is on "lab mac" with a reply-retired claim on screen (e.g. the composed notice from F1, or a `502`-derived "Reconnecting to the machine…" claim). Any swallowed background leg addressed to that machine — `PiWebApp.ts:1277-1284` `refreshMachineStatusSnapshots()` catches with `console.warn` only; `machineController.ts:204-213` uses `Promise.allSettled` and discards rejections; `refreshAfterBrowserResume` (`PiWebApp.ts:1244-1256`) fans out on every browser focus — hits `/api/machines/lab-mac/status`, gets a 502, and step 4→6 of F1 deletes the on-screen claim with nothing re-raised. At boot this is unavoidable: `machineStatuses` is empty so `shouldRefreshMachineActivity` (`PiWebApp.ts:~4091`) lets every machine through, and the offline status that would later filter the poll is only written *after* the poll that already cleared the claim.
Adjudication: **TRUE**, with the caveat that it shares a root cause with F1 (URL prefix read as route ownership) and needs a different second half of the fix (status-class gate). Repeated 502s also churn `clear→raise` pairs, which re-arms the 6s timer and the 1500ms hold on every poll (`PiWebApp.ts:3874-3879`) — cosmetically stable, but it means the "self-healing" expiry is really driven by poll cadence, not by six seconds.

## F3 — TRUE (doc drift, user-facing release note says something the code does not do)
`.changeset/banner-retirement-model.md:13-14`: "The six-second expiry **checks the retirement mark instead of guessing from the wording**." Code: `PiWebApp.ts:1095-1096` requires **both** — `errorRetiredBy === RetiredBy.reply` **and** `normalizeTransientError(error) !== undefined`. The inline comment at `PiWebApp.ts:1085-1094` is honest about the second gate; the changeset is not.
Consequence worth naming: lifetime is still wording-dependent, so any transient wording the table in `errorBanner.ts` has not met renders permanent. That is exactly the failure `notice.ts:8-14` cites as the reason the model exists ("every message the list has not met stays on screen forever"). A new gateway/daemon phrase will therefore arrive as a permanent red `role="alert"`, and the release note tells the next maintainer wording is irrelevant to lifetime.
Adjudication: **TRUE**, minor severity (text only; code behaviour is defensible and internally commented).

## F4 — TRUE (a recorded "verified clean" rests on a false premise)
`docs/design/research/r25-lane-c.md:317-320` records as verified-clean: "`piWebStatusPath("local")` has no `/machines/` segment, so web-owned successes do not clear 'local'-scoped claims". True of that one path (`clients.ts:107-109`, plus `api/config`/`api/plugins` when `machineId === undefined`, `clients.ts:129,133`) and false as a general statement — see F1: every other web-owned read is prefixed `api/machines/local/…` because `machinePrefix` defaults to `"local"` and `selectedMachineId` falls back to `"local"`. The closure was sampled from one path. There is no test anywhere asserting `machineIdFromUrl("api/machines/local/projects") === "local"`; the behaviour is unasserted, which is why the doc and the code could diverge silently.
Adjudication: **TRUE** (documentation debt; it is the reason F1 survived four rounds of review).

## F5 — FALSE: generic `fetch` failures stay page-scoped, so any machine's success erases them
`http.ts:38-43` rethrows the raw `TypeError`/`RequestTimeoutError`; only `RequestTimeoutError` carries a URL, and `notice.ts:107-108` extracts a machine for it, so a `TypeError("Failed to fetch")` on `api/machines/lab-mac/…` becomes a **page** claim (`notice.ts:31-34`, `machineId` omitted) and `PiWebApp.ts:1059` lets any machine's success disprove it. Sounds like the exact hole round 22 closed — but the failing hop is browser↔web process, which is shared by every machine: when it is down, no machine-scoped reply can arrive either, and every claim in flight is page-scoped, so there is no cross-machine erasure to perform. The one leg that *can* distinguish machines already stamps one (`pluginBackends.ts:63-77` wraps as `HttpError(describeError(error), 0, target.machineId)`).
Adjudication: **FALSE** — a real asymmetry, no reachable failure. Worth a comment in `http.ts`'s catch, not a fix.

## F6 — FALSE: producers bypassing `noticePatch` / `errorNoticePatch`
Grep for direct `error:` writes in state updates across `src/client` turns up only the two dialog-local writes in `authController.ts:152,290` (component-scoped dialog text, never the page banner) plus `machineController.ts` catch blocks, all of which go through `errorNoticePatch`. `errorNotice.ts:36` `clearErrorPatch()` is called unconditionally at the start of `projectController.loadProjects()` (`projectController.ts:35`) and `machineController.loadMachines()` (`machineController.ts:15`) and so wipes claims of *other* machines too, but that is the documented "a new load owns the banner" rule and each of those loads re-raises its own failure in its catch; it also runs *before* its request, so it is not what erases a peer machine's live claim in a steady state.
Adjudication: **FALSE.**

## F7 — FALSE: dead code / leftovers from the MachineSwitcher removal
Swept CSS, imports, exports and plugin contributions: no orphan class (`.machine-status` is still produced at `pi-web-plugins/machines/browser/MachineList.ts:147` and consumed by `sessionStateBadgeStyles`), no orphan export (checked `machineRowActions`, `machineStatusLabel`, `canRemoveMachine`, `suggestedMachineNameFromUrl`, `machineBaseUrlValidationMessage`, `renderHostDisclosureIcon/CloseIcon`, `machinesHostUi`, `filterMachines`, `shouldShowContextSearch`, `fuzzyRank`, `isAbbreviation`, `hasStatusUnread`, `statusActivityKind`, `actionMenuPanelStyle` — all have production callers), and `switcherInitialFocus` legitimately serves `QuickSwitcher`/`PromptHistoryPanel`. The dismiss control is `.error-dismiss` (`errorBanner.ts`) with the touch floor under `@media (pointer: coarse)` (`PiWebApp.ts:190-201`); the changeset's word "switcher" (`banner-retirement-model.md:19-21`) refers to the deleted file, not a live class.
Adjudication: **FALSE.**

## F8 — FALSE: rail/dot palette misalignment
All seven rail rules in `components/shared.ts` carry the exact colour of the dot class they pair with (running/asking/unread/starting/interrupted/idle/archived), including the archived and selected pairs. `.activity-indicator.sending` intentionally has no rail: pending rows render as `.pending-session-row.starting-session`, not `.action-row`, so there is no rail to align to (`sessionRowIndicator.ts` arbiter emits at most one mark per row). Specificity model is as claimed: every `:has()` rule is (0,1,0) and the row-state rules `.action-row.archived` / `.action-row.selected` are (0,2,0), so row state wins over inferred state.
Adjudication: **FALSE** — alignment correct.

---

## Verified clean, no file:line worth filing
- `bannerHold.ts` 1500 ms minimum-visible floor: honoured; the hold branch clears the expiry timer and re-arms it after the hold, so no timer leak (`PiWebApp.ts:3845-3900`).
- `bannerDismissedByReader` reset path: dismissal writes `clearErrorPatch()` and clears both timers (`PiWebApp.ts:3893`).
- `INTERRUPTED_RUNS_UNKNOWN_MESSAGE` uses `noticeForReader` → reader-retired → immune to transport clearing (correct: it does not assert anything about a link).
- `machineService` health caching (`DEFAULT_HEALTH_CACHE_TTL_MS`) does not save F1: the first poll of a round still returns 200 and still vouches.

## Suggested order of work
1. F1+F2 together, at the boundary: require `response.ok` **and** route-ownership evidence before vouching; the `scope` parameter of `reportTransportReachable` is the existing seam. Add the missing test: `machineIdFromUrl("api/machines/local/projects")` and "a 200 `{ok:false}` from `/machines/<id>/health` does not retire a `<id>`-scoped reply claim".
2. F4: correct `r25-lane-c.md:317-320` so the next round does not re-trust it.
3. F3: reword `banner-retirement-model.md:13-14` to "checks the retirement mark **and** the wording table", or drop the wording gate (the notice.ts:8-14 argument says the gate is the bug it was meant to kill).
