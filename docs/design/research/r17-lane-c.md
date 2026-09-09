# Round 17 — Lane C findings (verdict round)
Branch `refactor/plugin-architecture`, HEAD `0e40b77c`. Read-only review; no files touched.
Scope: wave files (lazySurfaces, PiWebApp wiring, AppNavigationPanel, AppContextBar, shared.ts,
PromptEditor, sessionController prefetch, api/inFlight, chatHistoryCache, machines activityBadge,
notice/errorNotice/errorBanner/transportHealth/http/bannerHold) plus the docs that describe them.
Every item carries file:line, a concrete failure scenario, and an adjudication.

---

## P1 — user-visible, deterministic

### C1. Every HTTP-status error banner erases itself ~1.5s after it appears
- `src/client/src/api/http.ts:48-54` — a non-2xx response throws `HttpError` **before** `reportTransportReachable()`;
  but the *next* successful response (any GET, and the app polls constantly: session status, machine health,
  freshness, goals) calls `reportTransportReachable()`.
- `src/client/src/api/transportHealth.ts` — one global listener, no machine/route identity.
- `src/client/src/components/PiWebApp.ts:973-974` (listener registration) → `PiWebApp.ts:1013-1021`
  `clearTransientError()` — clears whenever `errorRetiredBy === RetiredBy.reply`.
- `src/client/src/components/notice.ts:75` — `noticeFromError` maps **every** `HttpError` through
  `noticeFromTransport`, i.e. `retiredBy: "reply"`.
- `src/client/src/components/bannerHold.ts:1` — `BANNER_MIN_VISIBLE_MS = 1500`, so it is visible for at least
  1.5s and then disappears on the next successful poll.

Failure scenario: a 409/413/500 from `POST /api/sessions/:id/reply` (retired-by-reply by design) shows
"Could not save: HTTP 500 …". 400ms later the session-status poll succeeds → transport is reported reachable →
`clearTransientError()` wipes the banner. The user sees a red flash and no explanation. Same for 404/403 on a
rename, a delete, a machine health check on a *different* machine.
Adjudication: **TRUE.** An `HttpError` is proof the server *was* reached; retiring it on "a reply arrived / any
request succeeded" is a category error. `errorBanner.ts:5-7` states the opposite contract: "It stays until the
user dismisses it, another message replaces it, or the owning action clears it." The `bannerHold` work makes this
worse-looking-but-no-better: 1.5s is a flash, not a notice. Fix direction: `HttpError` → `retiredBy: "action"`
(the action completed, with a status), and give `reportTransportReachable` the machine id it vouches for.

### C2. `setRemoteRouteRestoreMessage` pastes its own previous message into the next one
- `src/client/src/components/PiWebApp.ts:1495-1504` — `const detail = health?.error ?? this.state.error;`
  then `setState({ error: `${name} is unavailable; reconnecting…${suffix}${detail ? ` ${detail}` : ""}` })`.
- `src/client/src/components/PiWebApp.ts:1484-1493` — every intermediate retry, and the exhausted attempt,
  call the same function. `REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS` (PiWebApp.ts:257) has 5 delays, so one
  outage calls this function **6 times** (initial + 4 retries + exhausted).

Failure scenario: the local machine answers `GET /api/health` fine at boot (`health.ok === true`, so
`health.error` is `undefined`), then the remote host drops off the VPN while a deep link is being restored.
Attempt 1 writes `X is unavailable; reconnecting…`. Attempt 2 reads that back out of `state.error` as `detail`
and writes it again behind the prefix, and so on. After the ladder the banner reads:
"X is unavailable; reconnecting… still unavailable. X is unavailable; reconnecting… X is unavailable;
reconnecting… X is unavailable…" — six copies, growing with every retry.
Adjudication: **TRUE.** Reads-its-own-output self-composition; the only thing that hides it is the branch where
`health.error` happens to be set (a machine that never answered at boot). Predates the wave (`ef22247d`), so the
round-15/16 producer sweeps never looked at it. Fix direction: keep the detail in a separate field, or build the
message from `(machineId, attempt)` state rather than from `state.error`.

---

## P2 — real defect, narrower blast radius

### C3. Two producers still write `state.error` without `errorRetiredBy` — the round-15 pair is not complete
- `src/client/src/components/PiWebApp.ts:1503` — `setState({ error: ... })` from `setRemoteRouteRestoreMessage`.
- `src/client/src/controllers/machineController.ts:149-152` — `...(health.ok ? {} : { error: `${name} is unavailable; reconnecting…` })`.
Neither passes `errorRetiredBy`, so the banner inherits whatever the *previous* producer left behind.
Adjudication: **TRUE** (both predate the wave, but they are exactly the "producers the round-15 fix didn't
convert" this round was asked to hunt). Consequence in combination with C1: if the previous error was
transport-retired, the machine-unavailable banner is cleared by the first successful request to *any* machine;
if the previous error was action-retired, the same banner never clears at all after the machine comes back.
The same sentence also has two independent producers (PiWebApp.ts:1503 and machineController.ts:151), which is
the round-16 "one fact, one producer" defect class.

### C4. `normalizeTransientError` swallows the machine name out of a composite message
- `src/client/src/components/errorBanner.ts:75-77` — `/failed to fetch|load failed|…/` returns
  `"Lost connection to PI WEB. Reconnecting…"` and `errorBanner` (line 19) renders **the normalized string
  instead of the original**, for the whole banner.
- Combined with C2's composite message (`"X is unavailable; reconnecting… Failed to fetch"`), the entire
  banner — including which machine — is replaced by the generic sentence.
Failure scenario: two machines, one remote; the remote drops. The only clue distinguishing "the laptop you are
typing on" from "the build box" is the machine name in the banner. It is erased, and the user is told the whole
app lost its connection. Adjudication: **TRUE.** The normalizer was written for single-clause transport strings
and is applied blindly to composite messages. Fix direction: normalize only when the *whole* message is a
transport phrase, or normalize the detail clause only.

### C5. `scheduleTransientErrorDismissal` ignores `errorRetiredBy` and races the retry ladder
- `src/client/src/components/PiWebApp.ts:1033-1042` — a 6s `setTimeout` (`errorBanner.ts:40`) clears any
  message that `isTransientError()` matches, with no `errorRetiredBy` check (compare `clearTransientError` at
  line 1014, which does check).
- `errorBanner.ts:23-28` documents "A permanent failure must never expire"; expiry is decided by *text shape*,
  not by retirement semantics.
Failure scenario: a deadline/abort message from a permanent failure (a request that "did not answer within"
because the daemon is genuinely down) is withdrawn after 6s while `REMOTE_ROUTE_RESTORE_RETRY_DELAYS_MS` keeps
retrying for 57s. The banner disappears, the failure does not. Adjudication: **TRUE** — two independent
withdrawal mechanisms (6s timer, transport-recovery) with different guards over the same state, which is the
round-15 retirement model re-entering through a second door.

### C6. The state rail still does not cover the vocabulary it claims to cover, and its colours contradict the dots
- `src/client/src/components/shared.ts:417-421` — the rail's stated job: "taking its colour from the state the
  row already reports … work in flight, an upload, something unread".
- `src/client/src/components/shared.ts:433-436` — the actual rails:
  `running|asking|activity-indicator.session → --pi-success`, `terminal|unread → --pi-accent`, `error → --pi-danger`.
  **`.session-state.background` has no rail at all** — "the turn ended, subagents still running"
  (`activityBadge.ts:56-57`) is textbook work-in-flight, and it is one of the six kinds
  `sessionRowIndicator.ts` emits.
- Colour disagreements for one fact: `.session-state.running` dots are `--pi-accent` (blue) but the rail is
  `--pi-success` (green); `.session-state.asking` dots are `--pi-warning` (amber) but the rail is green;
  `.session-state.unread` is `--pi-purple` (`sessionStateBadgeStyles.ts:38`, "Unread is purple … distinct from
  the blue of work in progress") while `.activity-indicator.unread` is `--pi-accent`
  (`shared.ts:444-445`, "keep it static and accent-colored") — two files give opposite reasons for two colours
  on the same state, and the rail forces a third relationship.
- The comment still promises "an upload": `.activity-indicator.sending` (`shared.ts:441`) gets **no rail**,
  because round 16 deleted that rule on the grounds that no `.action-row` produces it. The producer that does
  exist, `SessionList.renderStartingSession()` (the "Starting session…" row), renders `.pending-session-row`,
  which is not an `.action-row` and therefore has no rail border at all — so the one state the comment names
  is the one state with neither a rule nor a host element.
Adjudication: **TRUE.** Round-16 item 1's claim that "the rail names both vocabularies" is only half true; it
names two of the three states that mean work, and the colour of the rail is not the colour of the dot for
running/asking/unread.

### C7. `<machine-switcher>` is mounted permanently invisible in every phone layout
- `pi-web-plugins/machines/browser/pi-web-plugin.ts:47-57` — `renderMachinesSwitcher` hard-codes the
  `hidden` attribute and ignores `context.display.hidden` entirely. This is the *only* producer of
  `<machine-switcher>` in the app (`pi-web-plugin.ts:63`: `tiles ? switcher : list`, and the sole `tiles: true`
  call site is `AppNavigationPanel.ts:287`).
- `pi-web-plugins/machines/browser/MachineSwitcher.ts:295` — `:host([hidden]) { display: none; }`, applied
  correctly, so the element is genuinely, permanently `display: none`.
- `src/client/src/components/appShell/AppNavigationPanel.ts:276-279` justifies it: "the element stays mounted
  but **hidden for keyboard navigation**, its own `:host([hidden])` contract". But keyboard entry to the
  machines section is `@query("machine-list")` (`AppNavigationPanel.ts:119`, `122-129`), and the compact body
  already renders a real `machine-list` (`AppNavigationPanel.ts:237` via `renderMachineSectionSlot`, which
  passes `tiles: false`). No code path ever focuses or unhides the switcher;
  `machinesSection().focus` (`pi-web-plugin.ts:62`) reads `listRef`, which only the list path populates.
Failure scenario: nothing visible breaks — which is the finding. A ~330-line plugin element (its own styles,
fixed-position menu, document click listener at `MachineSwitcher.ts:36-41`, keyboard API) renders into every
phone layout, is `display:none`, and duplicates a machine list that is already in the same DOM.
`AppNavigationPanel.ts:531` (`machine-switcher { flex: 1 1 auto; min-width: 0; }`) is a layout rule for a
permanently hidden element, i.e. a dead rule resting on a dead element.
Adjudication: **TRUE** (dead UI + false comment). Either delete the switcher path or make the phone header
actually use it; the "keyboard navigation" reason does not hold.

### C8. The `link` seam in `noticeFromError` was built and never wired
- `src/client/src/components/notice.ts:57-71` documents a third retirement input ("while the socket is live, a
  transport timeout must not raise a banner"); `notice.ts:73` returns `NO_NOTICE` for that case.
- `src/client/src/components/errorNotice.ts:24-30` exposes `link`, defaulting to `{ live: false }`, and **none
  of the 57 `errorNoticePatch` call sites passes it** (sessionController 35, PiWebApp 7, machineController 6,
  authController 5, workspaceController 2, projectController 2).
Adjudication: **TRUE.** `notice.ts:73` is unreachable in production; the documented suppression never fires.
`transportHealth.ts` already knows the liveness fact the parameter asks for — the wiring was simply left undone.
Low risk today, but it means the doc block promises behaviour a reader will rely on.

### C9. Core and plugins adopt `listStyles` in opposite cascade orders
- Core components: `static styles = [sharedStyles, listStyles, ownCss]` — the component's own sheet is last
  and wins a tie.
- Plugins: `adoptedStyleSheets = [...ownStyles, listStyles]` (`adoptMachinesHostStyles`, used by
  `MachineList`, `MachineSwitcher`, and the rest of `pi-web-plugins/machines/browser/*`) — the host's shared
  sheet is last and wins a tie.
Failure scenario: the same class name (`.action-row`, `.action-main`, `.list-search`, `:host`) written in both
layers resolves one way for `session-list` and the opposite way for `machine-list`. A fix that works in a core
list silently fails for a plugin list, and vice versa — precisely the "fix one place, miss the other" pattern
this round is looking for, and it is invisible to the author because each file looks self-consistent.
Adjudication: **TRUE** (structural; no single line is broken today, the ordering is the defect).

### C10. `lazySurfaces` keeps a third hand-maintained copy of the surface list
- `src/client/src/components/lazySurfaces.ts` — `loaders` map, `SurfaceName` union, **and** an `isLazySurface`
  type guard listing the names again.
- `warmLazySurfaces` iterates the guard/list rather than `Object.keys(loaders)`, so adding a surface to
  `loaders` without updating the guard compiles cleanly and silently never warms.
- `lazySurfacesStarted` / `resetLazySurfaces` are exported for tests only, while round 16 item 7 asked for
  exactly that module-level state to stop being reachable from the outside.
Adjudication: **TRUE** (latent; one careless edit from a silent regression). Deriving the list from
`Object.keys(loaders)` with a single `satisfies` removes both the guard and the drift risk.

---

## P3 — cleanup, drift, dead code

| # | Where | Finding | Adjudication |
|---|-------|---------|--------------|
| C11 | `components/activityBadge.ts:83-97` | `renderSessionStateBadge` has zero non-test consumers (only `activityBadge.test.ts:95-122`). It was replaced by `renderSessionRowIndicator`. | TRUE, dead export |
| C12 | `components/activityBadge.ts:51-70` | Its doc block contradicts the live arbiter: "idle → static **green** dot" vs `sessionStateBadgeStyles.ts:29` `--pi-dim` (gray) and `sessionRowIndicator.ts:14-20` ("idle gray"); line 69 still says unread "wins as a separate attention ring", the composition model `sessionRowIndicator.ts:8-13` explicitly retired ("This module replaces composition with a ranking"). | TRUE, docs-vs-code drift |
| C13 | `components/sessionStateBadgeStyles.ts:31` | `.session-state.idle.unread` is only ever emitted by `renderSessionStateBadge` (the test-only renderer); `renderSessionRowIndicator` emits exactly one kind class. Dead rule, and it is the only place where unread means `--pi-success`. | TRUE, dead rule |
| C14 | `appShell/AppNavigationPanel.ts:532` | `:host([compact]) header { display: none; }` — `renderCompact()` emits `.compact-header` (divs, line 184-197), never a `<header>`. Dead rule. | TRUE |
| C15 | `machines/browser/MachineSwitcher.ts:308-314` | `.activity-indicator.*` rules for an element no switcher row produces (the switcher's rows use the plugin's `action-activity` path); unreachable. | TRUE, dead rules |
| C16 | `appShell/AppContextBar.ts:108-110` | `sessionContextLabel`'s `undefined → "No session"` branch never runs for the undefined case: line 46 handles the empty state with its own copy, "No session selected". Same phrase, two producers, one unreachable. | TRUE, dead branch + duplicated copy |
| C17 | `PiWebApp.ts:1761` + `PiWebApp.ts:672` | `openSettings()` calls `openLazySurface(...)`, then `willUpdate` sees `settingsOpen && !settingsLoadAnnounced` and calls it again; `loadSurface` dedupes but the comment claiming the surface is "loaded before shown" describes a fire-and-forget call. Round-16 fixed the URL-restore path; the comment is still wrong. | TRUE (harmless today), docs drift |
| C18 | `src/client/src/chatHistoryCache.ts` (`cacheKey`) | IndexedDB key is `"pi-web:chat-history:v2:" + sessionId` — no machine namespace — while every in-memory key is `machineSessionKey(machineId, sessionId)`. Two identity schemes for one cache; safe only under the unproven assumption that session ids are globally unique across federated machines. | TRUE (asymmetry); failure requires id reuse across federated machines — record the assumption or key it the same way |
| C19 | `components/notice.ts:85` | `retiresOnReply()` has zero non-test consumers. | TRUE, dead export |
| C20 | `components/shared.ts:309` | `.list-body.tiles { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) }` — the 150px floor is a hard minimum, so a tile list inside a container narrower than ~150px + padding (deep-nested drawer, split view at 320px) overflows horizontally instead of shrinking. | TRUE but low-frequency; needs `minmax(min(150px, 100%), 1fr)` |

---

## Verified clean (round-16 claims that hold, checked again here)

- **Prefetch chain** (`sessionController.ts:1900-1930`): `onPrefetchSession` → `api.messages/session/streamSnapshot`
  with an explicit `machineId`, and the result is written through `transcripts.mergeHistory(machineSessionKey(...))`,
  so a prefetched session really does land in both caches before the click. Round-16 verdict holds.
- **`inFlight.ts`**: GET-only de-dup, entry dropped in `finally`; no leaked map entries, no POST de-dup hazard.
- **`lazySurfaces` failure handling**: a rejected load is removed from the in-flight map, so a retry re-attempts;
  `PiWebApp.ts:1737-1758` clears the banner only when `state.error` is still that exact failure text, and
  `describeError` passes plain `Error.message` through unchanged, so the comparison does match.
- **`bannerHold.ts`**: the minimum-visible computation is correct in isolation (its interaction with C1/C5 is
  reported above, not a bug in the helper).
- **`.list-body.tiles .action-activity`** and the tile/menu inset maths are consistent with the tile variant's
  centre-line comment; `PromptEditor`'s collapsed footer keeps the round-16
  `min-height: var(--pi-control-height-touch)` fix.
- **`:host([hidden])` cascade trap** is handled correctly in every plugin element checked
  (`MachineSwitcher.ts:289-295`, `shared.ts:409-410` companion rules).
- **`SessionList.renderStartingSession()`**: the round-16 removal of the `.activity-indicator.sending` rail rule
  was justified for `.action-row` — the pending row is not one (see C6 for the part that is still missing).

## Suggested order of work
1. C1 + C3 + C5 together (one retirement model, one owner; `HttpError` → action-retired; make
   `reportTransportReachable` machine-scoped; make the 6s timer respect `errorRetiredBy`).
2. C2 (message composition) and C4 (normalizer scope) — same banner text pipeline.
3. C6 (rail vocabulary + colour agreement with the dots, or delete the promise from the comment).
4. C7 (delete or actually use `machine-switcher`), C8 (wire or delete the `link` seam),
   C9 (pick one cascade order for `listStyles`).
5. C10-C20 as a sweep.
