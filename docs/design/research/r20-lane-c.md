# Round 20 — lane C: banner retirement model, producer/consumer drift, rail rules, docs-vs-code

Scope read at HEAD `a0bbd9be` (`refactor/plugin-architecture`): notice.ts, errorNotice.ts,
errorBanner.ts, bannerHold.ts, transportHealth.ts, http.ts, requestDeadline.ts, clients.ts,
pluginBackends.ts, appState.ts, PiWebApp.ts, machineController.ts, sessionController.ts,
projectController.ts, reportedError.ts, shared.ts rail CSS, sessionRowIndicator.ts,
sessionStateBadge.ts / sessionStateBadgeStyles.ts, activityBadge.ts (core + both plugin copies),
MachineList.ts, appShell/AppNavigationPanel.ts, settings/SettingsMachinesPanel.ts,
src/server/web/app.ts, src/server/shared/piWebStatus.ts, src/shared/machineStatus.ts,
src/plugin-api.ts, scripts/audit-uiux-full.mjs, .changeset/banner-retirement-model.md,
.changeset/round-nineteen-seams.md, docs/design/*, `knip` runs.

Caveat on the moving target: the branch moved while this audit ran (`git reflog` shows resets
today; an early `git log` showed tip `305c67f4` with commits `305c67f4 docs(research)…` /
`07e2957e fix(web): row-menu styles for QuickSwitcher and chat header`, neither of which is
reachable from `a0bbd9be`). All line numbers below are `a0bbd9be`.

---

## A. TRUE defects, ordered by blast radius

### C1. TRUE, P1 — recovery vouches for the *web process*, so the banner for a dead daemon is erased by the next harmless request

`http.ts:50` reports reachability for **every** successful response, before the status check,
with `machineId = machineIdFromUrl(url)` — and `machineIdFromUrl` (`transportHealth.ts:33-36`)
returns `"local"` for any URL without `/machines/<id>/`. Every web-owned endpoint is therefore
an unscoped "local" success: `api/pi-web/runtime` (`clients.ts:112`), `api/pi-web/status`
(`clients.ts:93-94`, `machineId` defaults to `"local"`), `api/pi-web/version` (:103),
`api/machines` list/add (:108, :110), `api/pi-web/fleet` (`PiWebApp.ts:1014`), update
status/apply (:114-:115).

The failure this creates is specific and ugly, because `getPiWebRuntime`
(`src/server/shared/piWebStatus.ts:87-97`, served at `src/server/web/app.ts:248`) answers
**200 from the web process with `components.sessiond.available: false` inside the body**. The
one request whose payload says "the daemon is unreachable" is itself a transport success that
clears the "daemon unreachable" banner.

Failure scenario: daemon or remote machine dies → `refreshMachineHealth` (`machineController.ts:135-155`)
raises the scoped transport claim → for a selected *remote* it stays (a local success cannot
clear a scoped claim, `PiWebApp.ts:1037`) → the reader selects the local machine and does
anything (`cycleTheme` → `getPiWebVersion`, `clients.ts:590`) → `reportTransportReachable("local")`
→ `clearTransientError("local")` → the banner vanishes while the daemon is still down, and the
next thing that touches it raises it again.

Same shape for a remote whose fleet row arrives while its own claim is live: `fetchFleetSnapshot`
(`PiWebApp.ts:1014`) reads `api/machines` + `api/pi-web/fleet` — web-owned, unscoped — and
`syncRemoteConnectionHealth` then re-raises from the fleet payload (`PiWebApp.ts:1511-1534`).
Banner off, banner on, on every caller of that read.

Fix direction: `reportTransportReachable` should only vouch for what answered. Either carry the
component the request was routed to, or restrict recovery to requests that actually went through
the machine's own link (`/machines/<id>/…`), which is what the docblock at
`transportHealth.ts:24-31` already promises ("a success from machine A says nothing about machine
B's link").

### C2. TRUE, P1 — `errorNoticePatch` throws the machine away, so ~60 producers write claims the scoping rule cannot see

`errorNotice.ts:26-30`:

```ts
export function errorNoticePatch(error: unknown): AppStatePatch {
  const notice = noticeFromError(error);
  return { ...noticePatch({ ...notice, machineId: "local" }), errorHadDetail: notice.detail !== undefined };
}
```

`noticeFromError` already carries a `machineId` when it could read one (`notice.ts:97` scopes
every `RequestTimeoutError` by URL; `noticeFromTransport` takes the parameter) and
`noticePatch` (`errorNotice.ts:33-35`) honours `notice.machineId` — the patch then overwrites it
with the literal `"local"`. Only two producers in the client scope anything at all:
`PiWebApp.ts:1534` (remote-route restore) and `machineController.ts:154` (health check).

Three consequences:

1. The guard `PiWebApp.ts:1037` (`if (state.errorMachineId !== "local" && … !== machineId) return`)
   is unreachable in practice, and so is the comment at :1038-1039 explaining it.
2. Claims from different machines are indistinguishable: a remote-a gateway claim is cleared by a
   local success (C1) and a local claim is cleared by a remote-a success.
3. `noticeFromError`'s own URL-derived scope is destroyed on the way in — a `/machines/remote-b/…`
   timeout is filed under `local`.

Side effect in the same function: `errorHadDetail` (`errorNotice.ts:30`) is only ever *written*,
never read anywhere (`appState.ts:140`), and the comment at `errorNotice.ts:18-21` still describes
it as the thing that keeps two same-text failures distinct. `errorClaimSeq` is the real arbiter
(`notice.ts:59-65`).

### C3. TRUE, P1 — retirement is decided by the error's JS class, so any wrapper that re-throws a plain `Error` silently converts a healing claim into an imperative the reader must obey

`notice.ts:90-107` discriminates on `instanceof HttpError` / `TypeError` / `RequestTimeoutError`;
anything else falls to `noticeForReader` (`notice.ts:80`) — pinned until ✕, shown verbatim
(`errorBanner.ts:23` only rewrites reply-retired claims). Three live paths lose the class:

- `clients.ts:386` (`requestSessionTreeFork`) and `clients.ts:403` (`getOptionalTerminalCommandRun`)
  use `fetchWithDeadline` directly and throw `new Error(apiErrorMessage(body) ?? statusText)`.
  `forkSessionTree` (`sessionController.ts:777-778`) feeds that plain Error straight into
  `errorNoticePatch`. A gateway 502 whose body names the daemon socket is therefore pinned and
  printed in full — precisely the case `.changeset/banner-retirement-model.md` claims is fixed
  ("a gateway 502 whose body is a transport claim heals again"). The *same text* from
  `postJSON` gets `HttpError` → `isTransientError` → reply-retired. Two HTTP helpers, two
  lifetimes, one banner.
- `pluginBackends.ts:69` wraps the network failure itself:
  `new Error("Plugin backend request unavailable: TypeError: Failed to fetch")`. The TypeError is
  flattened into a string, so `notice.ts:96` cannot see it → reader-retired.
- `requestDeadline.ts:52-56` rethrows the caller's own `AbortError` untouched when the *caller*
  aborted — usually right, but a caller that aborts on its own timeout gets an imperative banner
  with a 6s-worthy message.

Both non-`http.ts` paths also skip `reportTransportReachable` entirely (it lives in `fetchBody`,
`http.ts:50`), so a success there proves nothing to the recovery seam either — a second, quieter
contradiction of "any server response is proof the link is not down".

Minimal fix: give `fetchWithDeadline` the same `HttpError`+report treatment as `fetchBody`, or
stop re-wrapping errors at the API edge. Retirement should follow the *evidence in the message*,
not the exception's pedigree.

### C4. TRUE, P1 — bare `setState({ error })` producers survive the seam, and one of them self-destructs a data-loss warning

The retirement model's whole point is the invariant "text and lifetime arrive together"
(`notice.ts:47-56`, `appState.ts:263-276`). Five sites still bypass it:

| site | shape | damage |
| --- | --- | --- |
| `sessionController.ts:532` | `setState({ error: "Copy your message before discarding this failed start." })` | adopts the **previous** banner's `errorRetiredBy` and `errorMachineId` |
| `sessionController.ts:655` | same, "Copy your message before switching away from this failed start." | same |
| `sessionController.ts:1789` | `setState({ error: "" })` | clears text, leaves `errorRetiredBy`/`errorMachineId` stale |
| `machineController.ts:14` | `setState({ error: "" })` at the top of every machine load | same |
| `projectController.ts:35` | `setState({ error: "" })` | same |

Concrete loss on the first two: a request times out → reply-retired banner is live
(`retiredBy: "reply"`) → the reader hits send on a session that never became ready → `:532` writes
the copy-your-text instruction, which inherits `retiredBy: "reply"` →
`scheduleTransientErrorDismissal` (`PiWebApp.ts:1064-1068`) expires it after
`TRANSIENT_ERROR_TIMEOUT_MS = 6000` and `clearTransientError` erases it on the next successful
read, even though a claim with "before discarding" in it is definitionally reader-retired. The
reader who obeys the banner keeps their text; the reader who waits six seconds loses it. Fix with
`setState(noticePatch(noticeForReader(…)))`, which also fixes the inherited-machine scoping.

The empty-string sites are the mirror bug: `machineController.ts:14` runs before every machine
load, including the one whose health check at `:154` sets `errorMachineId = <remote id>`; the next
bare write then inherits that remote id, and a local success no longer clears the local banner
(the `:1037` guard refuses) while a *remote* success does.

Also still bypassing the seam with hand-written strings: `PiWebApp.ts:3511-3517` ("Could not leave
this workspace. Retry.") and `PiWebApp.ts:2798` (ledger failure notice), both of which duplicate
the retirement argument at the call site instead of going through a producer.

### C5. TRUE, P2 — `.unread-ring` cannot paint a rail: the rail table has an unreachable entry, and the comment that justifies its ordering rests on a false premise

`shared.ts:420-424` promises the rail "wears the very colour the row's own dot wears … a row never
reads as one thing up close and another at scanning distance", and `:435-444` argues the rules
never compete ("The arbiter renders exactly one state dot per row, so these rules never compete;
order is belt-and-braces, not a contract").

Both are false for the unread+working composite. `activityBadge.ts:48` (both plugin copies) only
emits `unread-ring` when there is also a work kind, and the ring always wraps an indicator
(`shared.ts:462`). So a machine/workspace row with unread *and* work matches both `:445`
(purple, via `.unread-ring`) and `:446`/`:449` (success/accent, via the nested
`.activity-indicator.session`/`.terminal`). All three rules are `(0,1,0)`, the later ones win, and
the purple never paints — and there is no purple anywhere on that row anyway, because the ring
itself is `border: 1.5px solid var(--pi-accent)` (`:461`). The rule's own comment at `:457-459`
("Unread is a stable state … static and purple") describes a colour the row never shows.

Adjudication: a dead selector plus two comments that assert a property the cascade does not have.
Not a wrong colour by the dots' standard (green rail, green dot: consistent) — but if purple-for-unread
is intended, it is silently not happening, and only the owner can say which of the two is the spec.

Related, latent: the dot palette has four kinds (`.session`, `.terminal`, `.sending`, `.unread`,
`shared.ts:453-456`) but the rail table has no `.sending` entry. Today `.sending` is only rendered
on a `.pending-session-row` (`SessionList.ts:316-318`) which has no rail, so nothing is visibly
wrong — the first `.action-row` that carries a sending dot will wear a colourless rail next to an
amber dot.

### C6. TRUE, P2 — dead code the round-19 wave left behind

1. **`interruptedRunsUnknown` does not exist as state.** `PiWebApp.ts:308` declares it with the
   comment "Whether the last interrupted-runs read failed; a flag, not a wording match" — it is
   never assigned and never read anywhere in the repository. The retraction at `:786` is an exact
   string comparison against a literal duplicated from `:779`; edit either copy and the banner
   sticks for the session. `.changeset/round-nineteen-seams.md` ("it retracts by flag rather than
   by matching its own wording") describes an intention that never got wired up; the fix is one
   write at `:779` and one read at `:786`.
2. **`notice.ts:103-106` is unreachable.** `notice.ts:97` already catches every
   `RequestTimeoutError` and — worse for anyone who edits the wrong copy — keeps the URL-derived
   `machineId` there while the dead branch drops it. Any future change to transport-claim
   retirement applied to the visible-looking branch has no effect.
3. **`ReportedError` has no production consumer.** `src/client/src/controllers/reportedError.ts`
   (44 lines) plus `reportedError.test.ts` (61 lines): the only `new ReportedError(` in the repo is
   in the test. Its docblock states an ownership rule ("A controller may clear only the message it
   last reported itself, never one another controller reported") that nothing enforces or needs.
4. **Core `activityBadge.ts` is half dead.** `ActivityIndicatorKind`, `statusActivityKind` and
   `hasStatusUnread` (`src/client/src/components/activityBadge.ts:7,17,26`) have exactly one
   consumer, `activityBadge.test.ts`. Production uses `SESSION_STATE_LABELS` /
   `SessionStateBadgeKind` from that file, and the live indicator helpers are the two
   **byte-identical** plugin copies (`pi-web-plugins/machines/browser/activityBadge.ts` ==
   `pi-web-plugins/workspaces/browser/activityBadge.ts`, `diff -q` clean). The plugin copies have no
   "copied from" note, no test of their own, and nothing stops them drifting.

### C7. TRUE, P2 — `CORE_STATUS_FLAGS` is a wire contract spelled out as literals in three places, and the plugin API does not export it

Producer: `src/shared/machineStatus.ts:57-64`, used by `machineStatusService.ts:184-188` to publish
`core:working` / `core:terminal` / `core:unread`. Consumers: `pi-web-plugins/machines/browser/activityBadge.ts:5-9`
and `pi-web-plugins/workspaces/browser/activityBadge.ts:5-9`, each re-declaring the three strings by
hand (with a comment admitting it: "The flag ids PI WEB itself publishes today").
`src/plugin-api.ts:218` offers only `type NavStatusFlags = Record<string, boolean>`, and no test
asserts the wire strings from the consumer side (`activityBadge.test.ts` and the socket tests do
write `"core:working"` literals, but they pin the client's own copy, not the pair).

Failure scenario: someone renames `core:unread` (or the working flag) on the server. `tsc` passes,
lint passes, tests pass, and both navigation lists stop painting work and unread marks — the
failure is invisible rather than loud, in the one place whose whole job is "is anything happening
over there". Export the constant from `plugin-api.ts` and import it in both plugins.

### C8. TRUE, P2 — the dead-code gate in `npm run verify` does not see test-only-used code, which is why C6 keeps coming back

`npm run verify` runs `knip` (package.json:67). At the current tip:

```
$ npx knip --production --reporter json   # 27 unused dependencies, 1 binary, and
                                         # 0 unused files, 0 unused exports, exit 0
$ npx knip                               # {"issues":[]} — nothing at all
```

…while `ReportedError` (C6.3) has no production importer and core `activityBadge` exports are
test-only (C6.4). Two configuration smells go with it: `knip.json` **and** a `knip` key in
`package.json` both exist with duplicated ignore lists (`knip --debug` prints
`Unresolved configuration`, `config: undefined`), and every run prints "Configuration hints (2):
scripts/probe-r18-dup-list.mjs / probe-r19-row-menu.mjs — knip.json Remove from ignore" and still
exits 0, so CI cannot act on it. The `ignore` entries name files that do exist, so the hint means
"these ignores are unnecessary", i.e. nobody has read the hint.

Net effect: rounds 16-19 kept hand-discovering dead leftovers that the project's own gate cannot
see. One config change (make a test file not count as a consumer) turns this class of finding into
a build failure.

### C9. TRUE, P2 — the deleted machine switcher is still cited as live code in shipped surfaces

`src/client/src/components/MachineSwitcher.ts` was deleted in `b0bce2a0`; no file matches
`*MachineSwitcher*` anywhere. References that survive:

- **`pi-web-plugins/machines/browser/MachineList.ts:261`** — "The same mark-plus-word the switcher
  uses is already the selected-language pattern elsewhere in the UI." The sentence is the only
  justification for the component's shape, and names the one thing that no longer exists. (r19-a)
- **`pi-web-plugins/workspaces/browser/pi-web-plugin.ts:13`** — "Both switcher surfaces render
  workspaces unconditionally" about `workspacePickerControl`/`workspaceNavigation`, neither of
  which is a switcher surface any more. (r19-a)
- **NEW: `src/client/src/components/settings/SettingsMachinesPanel.ts:13`** — "The health dots
  mirror the machine switcher: ok = success…" — not flagged in round 19.
- **`docs/design/phone-navigation-model.md:35-37`** — asserts as a present defect that "the
  `machine-switcher` rendered permanently hidden", with the reasoning "The component exists, the
  data exists, the render call exists". All three were removed; the section still concludes with a
  fix for it.
- **`docs/capability-map-draft.md:49,54,231,242,247`** — "Switch machine | **MachineSwitcher**
  dropdown in nav panel", "Remove machine … MachineSwitcher actions", a whole row titled
  "MachineSwitcher options", and an evidence chain of `C:components/MachineSwitcher.ts:63-66`, `:98`,
  `:116`, `:303`, `:309`. A capability map — the document a new contributor is pointed at — whose
  file:line citations name a deleted file. The generated copy
  `docs/.deploy/dev/dev/capability-map-draft.md` carries the same lines and is untracked, so the
  tracked source is the thing to correct.
- **`docs/design/machines-axis-plugin-design.md:16`** and **`docs/design/machines-workspaces-extraction.md:156`**
  still list `MachineSwitcher` as an existing (respectively "plugin-owned", "moved") component.

### C10. TRUE, P3 — a reply-retired claim is an expiry, not a promise, so a persistent failure flickers

`.changeset/banner-retirement-model.md`: "the request timed out, which says nothing about the next
request". True — but with `TRANSIENT_ERROR_TIMEOUT_MS = 6000` (`errorBanner.ts:47`,
`PiWebApp.ts:1054-1068`) and an empty clear that is decisive (`PiWebApp.ts:3783-3789`,
`bannerDismissedByReader: true`), a link that is *still* down produces banner for 6s, nothing until
the next attempt, banner again. `applyBannerHold`'s 1500 ms floor (`bannerHold.ts:1`) only covers
*replacement*, not a clear followed by a re-raise, so it does not damp this. The wording promises
"self-retires"; the visible behaviour on a persistent failure is a pulse. This is inherent to the
model rather than a bug in it — worth an explicit owner decision (e.g. only expire when a request
has since succeeded, which is what `reportTransportFailure` does on the daemon side).

### C11. TRUE, P3 — doc/code drift inside the seams this wave created

- `errorBanner.ts:31-36` still says `isTransientError` is "Exported so the owner of the banner can
  let those expire on their own", and `:20` says the caller passes the text "already routed to its
  retiree". The owner now decides by `retiredBy` (a claim's lifetime), and uses the wording table
  only to *shorten* a reply-retired string; the exported predicate's stated reason for existing is
  half obsolete.
- `transportHealth.ts:24-31` is an orphaned docblock: it documents `reportTransportReachable`
  ("Report that the server answered…") but sits above `machineIdFromUrl`, which then gets a second
  docblock at `:32`. The function the first paragraph describes has no docblock.
- `notice.ts:15-17` calls `isTransientNetworkError`/`isAbortError` "dead code, deleted below" —
  neither name exists anywhere in `src/` any more, so the sentence is describing a deletion that
  was completed. Harmless, but it reads like a live warning to the next reader.
- **`PiWebApp.ts:2799-2803`** — "One snapshot and action set feeding the workspaces plugin's
  contributed pickers on **both switcher surfaces**" is the core-side twin of the plugin comment at
  `pi-web-plugins/workspaces/browser/pi-web-plugin.ts:13`; both describe the panel/sheet pair as
  "switcher surfaces", a word that meant the deleted machine switcher.
- Dated triage logs also still describe it as live (`docs/design/review-triage-uiux-round17.md:52`
  records an owner rule about "MachineSwitcher", `review-triage-activity-split-redblue.md:18` lists
  `MachineSwitcher:6` as a consumer of `activityBadge`, `review-triage-uiux-round16.md:47`). Those
  are records of their own round and the least urgent; the capability map and the code comments are
  not records, they are instructions.

---

## B. Checked and cleared (the FALSE side, so nobody re-reports these)

1. **FALSE — "`.activity-indicator.sending` is dead CSS"** (my own round-19 suspicion). It is
   rendered at `SessionList.ts:318`. Only the `ActivityIndicatorKind` union member `"sending"` is
   unused by `statusActivityKind`, which never returns it.
2. **FALSE — "the rail colours contradict the dot palette".** Going rule by rule against
   `sessionStateBadgeStyles.ts:27-36` and `shared.ts:453-459`: purple for unread/background/unread-ring,
   `--pi-success` for `activity-indicator.session` (machine/workspace work), `--pi-accent` for
   `session-state.running` (session work; the later rule at `:447` correctly beats `:446`, which is
   what the comment at `:442-444` argues for), `--pi-warning` for asking, `--pi-accent` for terminal,
   `--pi-danger` for error, none for `idle` or for plain `activity-indicator.unread`. Consistent,
   except C5. The one honest caveat: `.action-row.archived` and `.action-row.selected` are `(0,2,0)`
   and beat every dot rule, so a selected row asking a question wears an accent rail with an amber
   dot; the comment at `:451-452` admits this, but "exact colour" in the changeset overstates it.
3. **FALSE — "`--pi-rail-width` has no fallback".** Declared at `index.html:90` in the document
   `:root`, and custom properties inherit into shadow roots, which is what `shared.ts:426` relies
   on. (Aside: `blockquote` at `shared.ts:506` hard-codes `3px` where the token exists — cosmetic.)
4. **FALSE — "parse failures get transport retirement by accident".** `api/parsers.ts:13-56` throws
   plain `Error`s, so they land in `notice.ts:104` as reader-retired, which is right. A TypeError
   from deep property access would be misfiled as a transport claim, but no producer does that.
5. **FALSE — "`bannerHold` fights the retirement model".** `PiWebApp.ts:3783` treats a reader
   dismissal as decisive and skips the hold; `PiWebApp.ts:3793-3801` only holds a *non-empty*
   replacement for 1500 ms, which is exactly the flicker it names. (Nit: `bannerHoldTimer` is not
   cleared in `disconnectedCallback`, `:1072`; the callback writes to a detached element, harmless.)
6. **FALSE — "`clearTransientError`'s machine scoping is wrong".** The guard is right; C2 is why it
   never gets to act.
7. **FALSE — "recovery listener leaks / stacks".** One slot (`transportHealth.ts:17-22`), registered
   at `PiWebApp.ts:990`, withdrawn at `:1072` via `observeTransportRecovery(undefined)`.
8. **FALSE — "the cleanup dialog's errors bypass the banner seam".** `PiWebApp.ts:2164-2194` are
   dialog-local `error` fields (`sessionCleanupDialog.error`), never the global banner.
9. **FALSE — "the context audit trigger is a phantom after the switcher removal".**
   `scripts/audit-uiux-full.mjs:266` opens `.compact-scope`, which is
   `appShell/AppNavigationPanel.ts:186` ("Machine, Project, Workspace") — live, and the only entry
   point now that the switcher is gone. The trigger works; the *cost* is that machine switching now
   always needs the context sheet, which the removal changeset should have recorded.
10. **FALSE — "`reportTransportReachable` before the status check is a bug".** `http.ts:47-50`
    documents the reasoning and it holds for its own case (a 500 is proof the server answered).
    C1 is about *what* it vouches for, not *when*.
11. **OPENED, not closed — round-19 lane C's P1 (`QuickSwitcher` row-menu `style=undefined`) is
    still in the tree at `a0bbd9be`.** `src/client/src/components/QuickSwitcher.ts:247` contains
    byte-for-byte `<div class="action-menu-panel row-menu" role="menu" style=undefined>` (verified
    with `od -c`), while `menuStyle` is still computed at `:241` and stored at `:71`. A commit named
    "fix(web): row-menu styles for QuickSwitcher and chat header" (`07e2957e`) was visible in
    `git log` early in this session and is not reachable from the current tip — if that fix exists
    on a dropped ref, it needs cherry-picking rather than re-deriving.

## C. What I would fix first, if the answer is yes

1. C2 + C1 together, in that order: stop flattening `machineId` in `errorNoticePatch`, then stop
   letting a web-process answer vouch for a machine's link. Without the first, the second has
   nothing to scope to.
2. C4's two `:532`/`:655` sites — one-line changes, and one of them stops the UI from discarding an
   instruction about unsaved text.
3. C6.1 and C6.2 — five lines total, both currently load-bearing-looking comments that lie.
4. C8 — a knip config that treats test-only exports as dead, so the next lane does not spend its
   budget rediscovering the same three files.
