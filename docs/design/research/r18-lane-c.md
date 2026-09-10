# Round 18 — Lane C: cross-file consistency, leftovers, docs-vs-code drift, retirement-model gaps

Repo: `pi-web` @ `refactor/plugin-architecture` / `b0bce2a0`. Read-only review.
Verification method: source reading + `grep` producer/consumer enumeration + **empirical
rendering** (vitest + happy-dom for the compact shell; Playwright/Chromium for computed rail
colours). Scratch files deleted; `git status` shows no lane-C residue.

Verdict legend: **TRUE** = defect/claim reproduced. **FALSE** = suspected, disproven.

---

## C1 — TRUE (P1) — Removing `MachineSwitcher` turned a permanently-hidden mount into a second *visible* machine list on every phone screen

**Where**
- `pi-web-plugins/machines/browser/pi-web-plugin.ts:41-46` — `render` used to branch on
  `context.display.tiles` (`tiles ? renderMachinesSwitcher : renderMachinesList`); the branch is
  deleted, so `render` is now unconditionally `renderMachinesList`.
- `src/client/src/components/appShell/AppNavigationPanel.ts:203` — compact shell calls
  `renderMachineHeaderSwitcher()`.
- `AppNavigationPanel.ts:281-288` — that helper passes `display: { hidden: false, …, tiles: true }`
  and returns `section.render(context)`.
- `AppNavigationPanel.ts:211` → `:244-250` → `renderMachineSectionSlot(visible !== "machines")`
  — the *same* `section.render(context)`, second call site.
- `AppNavigationPanel.ts:266-274` — `compactVisibleSection()` returns `"machines"` by default
  whenever a machines section is contributed and at least one machine exists.

**Failure scenario (empirically reproduced).** Mount `AppNavigationPanel` with
`compact = true`, two machines, and the real `machinesSection()` contribution:

```
machine-list instances in the compact shadow root: 2 — both .hidden === false
```

`compactVisibleSection() === "machines"`, so `renderMachineSectionSlot(false)` unhides the slot
copy while the header copy hard-codes `hidden: false`. The phone shows the whole machine fleet
twice, stacked, each with `flex: 1 1 auto; min-height: 0` (`AppNavigationPanel.ts:537`) fighting
for the same vertical space — above the projects list, which is the reason the phone screen
exists. Before this commit the header copy was `<machine-switcher hidden>` (hard-coded attribute,
`git show HEAD` diff) and rendered nothing.

Second, independent symptom from the same call site: **the machines collapse control is dead on
phones.** With `machinesCollapsed = true` the probe gives `[0: VISIBLE, 1: hidden]` —
`renderMachineHeaderSwitcher()` never consults `machinesCollapsed` (it only checks
`shouldShowMachinesSection(this.machines)`), so collapsing "Machines" hides the copy nobody sees
and leaves the copy everybody sees on screen.

Also note `pi-web-plugin.ts` deletes the CSS that used to size the old element
(`machine-switcher { flex: 1 1 auto; min-width: 0; }`, removed at `AppNavigationPanel.ts:528`)
but the replacement `machine-list` inherits the *scroll-region* sizing meant for the primary
list, which is why the duplicate consumes real height instead of sitting in the header row.

**Adjudication: TRUE.** The commit message says "the dead mount is removed". What was removed was
the *render branch*; the *call site* survives, and without the branch it now produces a visible
full list. Removing the header call site (`AppNavigationPanel.ts:203`) is the whole fix; the
`tiles` flag and the `renderMachineHeaderSwitcher` helper are then dead too.

---

## C2 — TRUE (P1) — The state rail does **not** wear the colour the row's dot wears; `.action-row.unread` beats every state rule on specificity, and the code comment says it is source order

**Where**
- `src/client/src/components/shared.ts:426` — `.action-row { border-left: … transparent }` → (0,1,0)
- `shared.ts:439-444` — six rail rules written as `.action-row:has(:where(…))` → **specificity (0,1,0)**
- `shared.ts:445` — `.action-row.unread { border-left-color: var(--pi-purple); }` → **specificity (0,2,0)**
- `shared.ts:427-438` — the two comments that explain the design, including
  *"Source order is the precedence (equal specificity): unread < running < asking, matching the
  row indicator's own arbiter."*
- `src/client/src/components/SessionList.ts:398` — the session row carries the `unread` class
  whenever `sessionRowUnread()` is true (`SessionList.ts:883-886`: plain set membership; **not**
  mutually exclusive with a running/asking state).
- `src/client/src/components/sessionRowIndicator.ts:47-59` — the arbiter: asking > running >
  unread, so a running unread row renders **one** `.session-state.running` dot and *no*
  `.session-state.unread` dot.
- `src/client/src/components/sessionStateBadgeStyles.ts:39` — `.state-dot { background: var(--pi-accent) }`

**Failure scenario (empirically reproduced in headless Chromium, computed
`border-left-color` on a real `.action-row` inside the shadow root):**

| row markup | dot colour | rail colour (computed) | claim holds? |
|---|---|---|---|
| `.action-row.unread` + `.session-state.running` | accent blue | `rgb(128,0,128)` **purple** | **NO** |
| `.action-row.unread` + `.session-state.asking` | amber | **purple** | **NO** |
| `.action-row` + `.session-state.background` | purple hollow ring | `rgba(0,0,0,0)` **transparent** | **NO** |
| `.action-row.selected` + `.session-state.asking` | amber | accent | NO (intended) |
| `.action-row.unread` + `.session-state.unread` | purple | purple | yes |

The first row is not an edge case — it is *the* common case. An unread session that is currently
working is exactly what a working app looks like, and the arbiter deliberately drops the unread
dot for it (`sessionRowIndicator.ts:26-30`: "work in progress outranks the … flag"). The row
keeps the class, `shared.ts:445` wins on specificity, and the reader gets a purple rail above a
blue working spinner — the precise "reads as one thing up close and another at scanning distance"
failure the doc block at `shared.ts:419-424` says the design eliminates.

Two distinct defects in one rule:
1. **`.action-row.unread` (line 445) is redundant.** Every producer already reaches purple
   through line 439 (`.session-state.unread` for session rows, `.activity-indicator.unread` /
   `.unread-ring` for machine/workspace/project rows). Its *only* observable effect is to
   override work colours it is documented to rank below.
2. **The comment at line 435 is factually wrong.** Specificity is not equal — (0,2,0) vs (0,1,0) —
   so source order is never consulted. The comment is the reason the bug reads as intended.

(`.action-row.selected` at line 447 is a genuine, documented trade-off — the comment at 427-431
says row-state rules are *meant* to override. `.action-row.unread` and `.action-row.archived`
were swept in with it.)

**Adjudication: TRUE.** Delete line 445 (line 439 already covers it); the same edit makes the
comment true.

---

## C3 — TRUE (P2) — `.activity-indicator.unread` dot is accent blue, its rail is purple: the same commit changed the rail and left the dot

**Where**
- `shared.ts:452-453` — `/* Unread is a stable state … keep it static and accent-colored. */
  .activity-indicator.unread { background: var(--pi-accent); … }`
- `shared.ts:439` — the same class drives a `var(--pi-purple)` rail.
- Producers: `pi-web-plugins/machines/browser/activityBadge.ts` and
  `pi-web-plugins/workspaces/browser/activityBadge.ts` (`renderActionActivityIndicator` emits
  `.activity-indicator unread` for an idle row with unread descendants; `.unread-ring` for a
  working one), consumed at `pi-web-plugins/workspaces/browser/ProjectList.ts:234-236`,
  `WorkspaceList.ts:203-205`, and the machines `MachineList`.
- The rail rules *do* reach these rows: `pi-web-plugins/*/browser/hostUi.ts` adopts
  `cssResultSheets([host.surfaceStyles, host.listStyles])` into each plugin shadow root, and the
  rail block lives in `listStyles`.

**Failure scenario.** A project with unread sessions and no live work: the row's dot is **blue**,
the rail beside it is **purple**. Same row, two identities — and the blue is correct per
`activityBadge.ts`'s own comment, the purple is correct per the changeset. Both were changed in
good faith by different halves of the same wave. Reproduced in Chromium: computed dot
`var(--pi-accent)`, rail `rgb(128,0,128)`.

Note the arbiter-free zone: session rows were given one vocabulary (`sessionRowIndicator.ts`),
but machine/project/workspace rows were never reconciled to it, so "the rail wears the exact
colour the row's own dot wears" is only checkable per-vocabulary, and this vocabulary disagrees.

**Adjudication: TRUE.** Either `.activity-indicator.unread` becomes `--pi-purple` (matching
`.session-state.unread`) or line 439 stops claiming unread.

---

## C4 — TRUE (P2) — `.session-state.background` has a dot and no rail rule: a transparent rail beside a purple ring

**Where** `sessionStateBadgeStyles.ts:30` (`.session-state.background { border: 2px solid var(--pi-purple) }`),
`sessionRowIndicator.ts:56` (it is a reachable kind: `if (stateKind === "background") …`),
`shared.ts:439-444` (no rule names `background`).

**Failure scenario.** A session waiting on a background ask, no unread flag (unread outranks it,
so it only appears when the row is *not* unread and line 445 cannot rescue it): purple hollow
ring, no rail at all. Every other reachable kind gets a rail. This is a gap in the "six states,
six rails" claim, not in a specific colour.

**Adjudication: TRUE.** One line at line 444's side fixes it.

---

## C5 — TRUE (P1) — The per-machine retirement the changeset promises is implemented for 6 call sites and skipped by 63

**Where**
- `.changeset/banner-retirement-model.md`: *"recovery is now vouched for per machine: a success
  from machine A no longer erases machine B's complaint."*
- `src/client/src/errorNotice.ts:24-30` — `errorNoticePatch()` returns
  `Pick<AppState, "error" | "errorRetiredBy">`. **No `errorMachineId`.**
- `src/client/src/errorNotice.ts:33` — `noticePatch()` is the only seam that writes
  `errorMachineId`, and it has **6** production call sites (`PiWebApp.ts:770,1521`;
  `sessionController.ts:881,905,1540,1701`; `machineController.ts:97,154`).
- `src/client/src/components/PiWebApp.ts:1024-1026` — `clearTransientError()` gates on
  `this.state.errorMachineId !== machineId`.
- `appState.ts:271` — `errorMachineId` initialises to `"local"`.
- `errorNotice.test.ts:60` pins `Object.keys(errorNoticePatch(…))` to exactly
  `["error","errorRetiredBy"]`, so the omission is deliberate and guarded.
- `PiWebApp.ts:1024-1032` — `clearTransientError` clears `error` but never resets `errorMachineId`.

**Failure scenario A — a legitimate recovery is refused (banner outlives its evidence).**
Deep link to remote machine **beta** while it is down →
`machineController.ts:154` writes `{error: "beta is unavailable…", errorRetiredBy: "reply",
errorMachineId: "beta"}`. Beta recovers, socket opens, `clearTransientError("beta")` clears
`error` — and leaves `errorMachineId: "beta"` behind forever. The user works on **local**; the
web process restarts and one fetch rejects with `TypeError` →
`sessionController.ts:439` (`errorNoticePatch`) sets `{error: "Failed to fetch", errorRetiredBy:
"reply"}` and **does not touch `errorMachineId`**, which still reads `"beta"`. The gateway is back
within a second, every local success calls `reportTransportReachable("local")` →
`PiWebApp.ts:1026` compares `"beta" !== "local"` and returns. The socket reconnect at
`PiWebApp.ts:1905` runs the same guard with the same result. The banner is only removed by the
6 s expiry at `PiWebApp.ts:1041-1056`, i.e. the model's own safety net papers over the hole.

**Failure scenario B — an unrelated machine's success erases a live complaint.** Same stale
`errorMachineId: "beta"`, now **local** genuinely loses its link (`errorNoticePatch`, so the scope
field is still `"beta"`). Beta's socket happens to reconnect →
`clearTransientError("beta")` matches the stale field and clears a banner that was about the local
gateway. This is the exact event the changeset says can no longer happen, and it is *not* bounded
by any timer — the banner is gone while local is still down.

**Adjudication: TRUE.** The seam that was built to make the pair inseparable
(`errorNotice.ts:11-22` says exactly that) was not extended when the model grew a third field.
`notice.ts:26` documents `machineId` as part of a Notice; `errorNoticePatch` drops it.

Secondary, same seam: `noticePatch` maps "no machine" to the string `"local"`
(`errorNotice.ts:34`), and `"local"` is simultaneously a real machine id (`api/machines/local/…`).
`reportTransportReachable` (`transportHealth.ts:36`) derives `machineId` from the URL, so a local
machine's success and a page-level claim are the same token — a remote machine's success clears a
"global" claim by the guard's own first clause (`PiWebApp.ts:1026`). Documented at
`transportHealth.ts:28-30`, so it is a known overload rather than an accident; noting it because
C5 makes the token load-bearing far more often than before.

---

## C6 — TRUE (P2) — `applySelfUpdate` bypasses the seam and inherits a stranger's retirement mark, so "Update failed" can self-expire

**Where** `PiWebApp.ts:858` and `PiWebApp.ts:866` — bare
`this.setState({ error: \`Update failed: ${result.error}\` })`, followed by an explicit
`this.scheduleTransientErrorDismissal(...)`.

**Failure scenario.** `scheduleTransientErrorDismissal` (`PiWebApp.ts:1041-1049`) returns early
unless `state.errorRetiredBy === RetiredBy.reply`, and `setState` here does not write that field.
So the lifetime of "Update failed: <reason>" is decided by whatever message happened to be on
screen a moment earlier. If any earlier link failure left `errorRetiredBy: "reply"` — the normal
state during a restart, which is exactly when a self-update is attempted — the render path at
`PiWebApp.ts:3782-3784` arms the 6 s timer and a permanent, actionable failure disappears while
the reader is still reading it. On a fresh page (`errorRetiredBy` starts as `reader`,
`appState.ts:270`) the explicit `scheduleTransientErrorDismissal` call is unreachable dead code.
Both directions are wrong, and they are wrong because of which message came first.

**Adjudication: TRUE.** Two lines, and the commit message names this exact race ("a message the
model called permanent could still be expired here") while leaving a third instance of it.

---

## C7 — TRUE (P2) — `refreshInterruptedRuns` is a poll, and it erases the reader-retired banners the same commit promised polls cannot erase

**Where** `PiWebApp.ts:762-774` — on a failed read:
`this.setState(noticePatch(noticeForReader("Interrupted-run status is unknown: …")))`.
Call sites: `PiWebApp.ts:1899` (every `connectRealtime`), `PiWebApp.ts:1916` (**every socket
reconnect**), `PiWebApp.ts:2449` (every context/switcher open).

**Failure scenario.** A 507 from an archive attempt raises a reader-retired banner
(`sessionController.ts:881`) — per this commit, it stays until the reader dismisses it. The
realtime socket flaps (a phone sleeping is called out by name at `transportHealth.ts:9`), the
reconnect handler runs `refreshInterruptedRuns`, its `/interrupted-runs` read fails, and
`noticePatch(noticeForReader(…))` overwrites `error` unconditionally. The archive failure the user
was about to act on is replaced by "Interrupted-run status is unknown" — with `errorMachineId`
reset to `"local"` as a bonus (C5). The commit removed one class of poll-overwrite and left a
producer that runs on every reconnect doing the same thing through the "official" seam.

Related half-fix in the same block: when the retry **succeeds** (`ids !== undefined`,
`PiWebApp.ts:772-773`) the state is no longer unknown, but nothing retracts the banner — the text
promises "Retrying the connection will resolve it" and then does not.

**Adjudication: TRUE.** The claim is only true of `bannerHoldDecision`'s hold window, not of the
reconnect fan-out.

---

## C8 — TRUE (P2) — `normalizeTransientError` rewrites the banner's *text* by wording, erasing which operation failed — the one thing the retirement model was built to stop doing

**Where**
- `src/client/src/components/errorBanner.ts:52-53` — if the message matches
  `/session daemon\b.*\bunavailable: connect (enoent|econnrefused)/i` **and** `/sessiond\.sock/i`, the
  entire displayed string is replaced by `"Reconnecting to the session daemon…"`.
- `errorBanner.ts:17` — that match also switches `role` from `"alert"` to `"status"` and drops the
  red styling (`errorBanner.ts:16,19`).
- `errorBanner.ts:42-53` is reached from `errorBanner()` at line 16, i.e. on **every** banner,
  whatever raised it.

**Failure scenario (reproduced by pattern).** `applySelfUpdate` writes
``Update failed: session daemon unavailable: connect ECONNREFUSED (/tmp/pi-sessiond.sock)``
(`PiWebApp.ts:858`, and the server hands back a raw `error.message` at
`src/server/routes/selfUpdateRoutes.ts:173`, `fleetRoutes.ts:139`, so the shape is not
hypothetical). The rule matches on the *tail* of the message and replaces the whole thing: the
banner now reads "Reconnecting to the session daemon…", which is (a) **soft** (`role="status"`,
no alert, not red), (b) **reader-retired** on a fresh page, so it never self-expires, and (c)
**wrong** — the self-update did not fail because the daemon is reconnecting; the daemon is down,
which is why the update could not happen. The operation the reader needs to retry ("Update") has
been deleted from the sentence. A permanent failure is therefore presented as a self-healing one,
by a wording table, on the same screen that this commit's thesis declares wording-independent.

The retirement model fixed *lifetime* immunity to wording (`PiWebApp.ts:1041` gates on
`errorRetiredBy`, not on text) and left *content and severity* entirely under
`normalizeTransientError`'s judgement. The commit's premise — "no decision a reader could check"
may be made by wording — is met for expiry and missed here.

**Adjudication: TRUE.** Narrow trigger, high confusion when it fires, and it fires exactly during
update/restart sequences. The fix is to prefix rather than replace
(`Reconnecting to the session daemon… (from Update failed)`) or to scope the rewrite to
transport-retired notices only.

---

## C9 — TRUE (P2) — The liveness guard that this commit's timeout rule depends on is unreachable: `link.live` is never passed by any production caller

**Where**
- `src/client/src/notice.ts:77` — `noticeFromError(error, link: { readonly live: boolean } = { live: false })`.
- `notice.ts:66-76` — the doc block: *"Whether the realtime socket is proven **live** changes the
  verdict, because that is evidence the user could not have had when the deadline expired. A
  deadline miss therefore raises nothing here while the socket is proven live."*
- `notice.ts:78` — the `RequestTimeoutError && link.live` → `NO_NOTICE` branch.
- `src/client/src/errorNotice.ts:25,27` — `errorNoticePatch` accepts `link` and forwards it, with
  the same default.
- Producers: `grep -rn "noticeFromError" src` returns only `errorNotice.ts:27`; no call site in
  `src/` or `pi-web-plugins/` passes a `link` argument. `socketLiveness.ts`'s verdict is read only
  by `sessionSocket.ts:67,208`, never by the notice layer.
- `retiresOnReply` (`notice.ts:99`) likewise has no production consumer, only `notice.test.ts`.

**Failure scenario.** The socket is healthy and streaming; one HTTP request exceeds its deadline
(e.g. a cold large-repo read). `noticeFromError` sees `link = {live: false}` because nobody ever
tells it otherwise, so it raises a "did not answer within…" banner that the module's own docstring
says should not have been raised — and marks it **reply-retired**, so it self-expires in 6 s
(`PiWebApp.ts:1041`) even though nothing is wrong. The reader watches a connection complaint about
a connection that is demonstrably fine. The evidence existed in the process at that instant; the
seam to deliver it exists too; the wire between them was never run.

This makes the newly-changed `RequestTimeoutError → RetiredBy.reply` branch doubly inconsistent:
the commit made the banner self-heal, while the code that would have prevented it stays dead.
The tests in `notice.test.ts` exercise `link: {live: true}` directly, so the branch is green and
unreachable at the same time — the classic shape of a seam that was defined and never connected.

**Adjudication: TRUE.** Pre-existing wiring gap, but this commit changed the semantics of the very
branch it leaves stranded, and `errorNotice.ts:19-22` explicitly reasons about the case ("Whether
the socket is live is evidence the reader did not have …"). Either pass the liveness verdict from
`http.ts`/`sessionSocket.ts` or drop the parameter and rewrite the docstring.

---

## C10 — TRUE (P2) — Both machine lists bind the same module-level `Ref`, so keyboard "focus machines" targets a different element than focus traversal does

**Where**
- `pi-web-plugins/machines/browser/pi-web-plugin.ts:18` — `const listRef: Ref<MachineList> = createRef()`
  is **module scope**, not per-render, and `renderMachinesList` attaches it at `:21`.
  `AppNavigationPanel` calls `section.render(context)` twice per compact render (`:203`, `:244`),
  so two `<machine-list>` elements commit into the same `Ref`; lit's last commit wins.
- `pi-web-plugin.ts:44` — `focus: async () => await listRef.value?.focusSelectedOrFirst()`
  (the plugin's palette/sheet focus entry).
- `AppNavigationPanel.ts:119` — `@query("machine-list")` (arrow-key section traversal,
  `focusNavigableSection` at `:125`) resolves the **first** match.

**Failure scenario (empirically reproduced).** With the probe panel mounted:
`machinesSection().focus()` calls `focusSelectedOrFirst()` on instance **1** (the primary-list
slot); `panel.machineList` — what `focusNextSection`/`focusPreviousSection` walk to — is instance
**0** (the header copy). Pressing the palette shortcut focuses the hidden lower list while Tab
traversal lands in the visible upper one, so the caret and the visible focus ring disagree by one
whole machine list. When `machinesCollapsed` is true, instance 1 is `display: none`
(`:host([hidden])`, `shared.ts:256`) and the palette shortcut focuses an invisible element and
reports success (`?? false` never fires), so the keyboard dies silently.

**Adjudication: TRUE.** Currently latent behind C1 — fix C1 and this becomes unreachable rather
than correct, so it is worth fixing as `renderMachineHeaderSwitcher` removal + per-instance ref,
or the invariant stays broken for the next contributor who renders the section twice.

---

## C11 — TRUE (P3) — Dead rule + dead renderer pair: `.session-state.idle.unread` and `renderSessionStateBadge`

**Where** `sessionStateBadgeStyles.ts:31` — `.session-state.idle.unread { background: var(--pi-success) }`.
The only producer of that class combination is `activityBadge.ts:95`
(`class="session-state ${kind} unread"`), i.e. `renderSessionStateBadge`, whose only callers are
`activityBadge.test.ts:34` and `sessionStateBadgeStyles.test.ts`. `renderSessionRowIndicator`
emits exactly one class (`sessionRowIndicator.ts`) and can never produce `idle unread`.
Green appears in no rail rule either.

**Adjudication: TRUE** — a styled state nothing renders, rendered only by a function nothing
calls. Both go in one commit.

---

## C12 — TRUE (P3) — `activityBadge.ts` is now a core-owned seam whose render functions have zero production consumers

**Where** `src/client/src/components/activityBadge.ts` — production imports across the repo are
only `SESSION_STATE_LABELS` and the `SessionStateBadgeKind` type
(`sessionRowIndicator.ts:2`, `QuickSwitcher.ts`, `ChatView`, `PiWebApp`, `SessionList`). Zero
production callers for `renderActivityIndicator` (:19), `renderSessionStateBadge` (:83),
`renderActionActivityIndicator` (:111), `statusActivityKind` (:39), `hasStatusUnread` (:48) — the
live copies are the plugin-local duplicates at
`pi-web-plugins/machines/browser/activityBadge.ts` and `pi-web-plugins/workspaces/browser/activityBadge.ts`.
Same shape in `errorBanner.ts:30` — `isTransientError` is exported "so the owner of the banner
can let those expire on their own"; the only references are `errorBanner.test.ts` and
`bannerHold.test.ts`. The owner stopped needing it in an earlier round and the doc comment still
narrates it.

**Adjudication: TRUE (low).** No runtime failure; the cost is that the core file *looks* like the
vocabulary seam while the plugins have already forked it, which is how the two vocabularies in C2
and C3 drifted apart unnoticed.

---

## C13 — TRUE (P3) — Doc / comment drift introduced or left by this commit

| Statement | Where | Reality |
|---|---|---|
| "the element stays mounted but **hidden** for keyboard navigation, its own `:host([hidden])` contract" | `AppNavigationPanel.ts:275-279` | It passes `hidden: false` (`:285`) and is a `machine-list`; it is visible (C1). The `:host([hidden])` contract it cites lives in `shared.ts:256`. |
| "the list **and the compact switcher** render from that snapshot alone" → "the list renders…" | `pi-web-plugin.ts:8-14` | The rewrite left a mid-sentence line break ("The add\ndialog opens…"), a cosmetic tell that the paragraph was patched, not updated. |
| `display: { …, tiles: true, … }` | `AppNavigationPanel.ts:285` | **Nothing reads `display.tiles` anymore.** `renderMachinesList` (`pi-web-plugin.ts:19-38`) never touches it and `MachineList` has no `tiles` property. The `tiles` member of the plugin-api `display` contract is now a dead parameter with one caller. |
| `notice.ts:70` | `docs/design/operation-model.md:24` | `noticeFromError` moved to `notice.ts:77`; this commit added 23 lines to the file and moved the anchor inside `describeError`'s doc block. |
| MachineSwitcher as a live component | `docs/design/machines-axis-plugin-design.md:16`, `pi-twin-plugin-design.md:125`, `element-native-vs-plugin.md:45`, `machines-workspaces-extraction.md:37,156`, `capability-map-draft.md:49,54,231,242,247`, `phone-navigation-model.md:36` | `MachineSwitcher.ts` no longer exists. `element-native-vs-plugin.md:45` still rules it "native — ruled core method", which is now a decision about a deleted file. |
| `"Switch"` as an acceptable sheet-opener label | `scripts/audit-uiux-full.mjs:275` | The term was only ever on MachineSwitcher's trigger; the bounded poll now spends one of its four candidates on a word no element can produce. |

**Adjudication: TRUE (low)** — every row is verifiable; none causes a runtime failure; the `tiles`
parameter is the one worth acting on because it is a plugin-api surface, not prose.

---

## C14 — FALSE — suspicions checked and cleared

- **`decodeURIComponent` outside the `try` in `reportTransportReachable`**
  (`transportHealth.ts:36`) could throw on a malformed `%` and escape the "must not throw"
  contract at `transportHealth.ts:29-31`. It is outside the `try`, but every caller builds the URL
  with `encodeURIComponent` first, so no malformed sequence can reach it. **FALSE** in practice;
  still worth folding inside the `try` given the explicit contract.
- **`retiresOnReply` (`notice.ts:99-101`) is not orphaned** despite having no production caller —
  it is a documented guard under active test (`notice.test.ts:101-106`), so it earns its place. **FALSE.**
- **`renderHostDisclosureIcon` / `renderHostCloseIcon` are not MachineSwitcher leftovers** — both
  have live consumers in MachineList/ProjectList/WorkspaceList. **FALSE.**
- **`renderMachineHeaderSwitcher`'s API path is unaffected by the deletion** — `/api/machines/<encodedId>/…`
  is still served; the regex at `transportHealth.ts:36` matches the encoded form. **FALSE.**
- **`@query("machine-list")` binding still resolves** (`AppNavigationPanel.ts:119`) — verified
  non-null in the compact probe. **FALSE** as an orphan; TRUE as a target mismatch (C10).
- **The quick-switcher is unaffected by the rail change** — it uses `.row`, not `.action-row`, so
  no rule at `shared.ts:439-447` applies; its own `.row-flag.unread` marker is unchanged. **FALSE.**

---

## Summary

| # | Verdict | Severity | One line |
|---|---|---|---|
| C1 | TRUE | **P1** | Deleted render branch leaves a second **visible** machine list on every phone screen; collapse control is dead there |
| C2 | TRUE | **P1** | `.action-row.unread` (0,2,0) beats all six rail rules (0,1,0); running/asking rows get a purple rail; comment blames source order |
| C5 | TRUE | **P1** | `errorNoticePatch` never writes `errorMachineId` (63 sites) and `clearTransientError` never resets it → stale scope both blocks real recoveries and permits unrelated ones |
| C3 | TRUE | P2 | `.activity-indicator.unread` dot stayed accent while its rail became purple |
| C4 | TRUE | P2 | `.session-state.background` has a purple dot and no rail rule at all |
| C6 | TRUE | P2 | `applySelfUpdate` bare `setState` inherits a stranger's `errorRetiredBy`; permanent failure self-expires in 6 s |
| C7 | TRUE | P2 | `refreshInterruptedRuns` runs on every socket reconnect and overwrites reader-retired banners; success never retracts it |
| C8 | TRUE | P2 | `normalizeTransientError` replaces the whole banner text by wording, deleting which operation failed and downgrading `alert` to `status` |
| C9 | TRUE | P2 | `link.live` is never passed in production, so the documented "silent while the socket is proven live" timeout rule is unreachable |
| C10 | TRUE | P2 | Shared module-level `listRef` + `@query` first-match → two focus paths, two different elements |
| C11 | TRUE | P3 | `.session-state.idle.unread` rule and `renderSessionStateBadge` are a dead pair |
| C12 | TRUE | P3 | Five dead exports in `activityBadge.ts`, `isTransientError` in `errorBanner.ts` with a stale rationale |
| C14 | FALSE | — | Six suspicions cleared, listed with evidence |
| C13 | TRUE | P3 | Stale comment at `AppNavigationPanel.ts:275-279`; dead `display.tiles` parameter; `notice.ts:70` anchor; 8 docs still describe MachineSwitcher as live |

**Changeset claims, adjudicated**
- *"recovery is now vouched for per machine: a success from machine A no longer erases machine B's
  complaint"* — **half true.** True at the 6 `noticePatch` sites, false at the 63
  `errorNoticePatch` sites that never set the scope (C5).
- *"The state rail now wears the exact colour the row's own dot wears — running blue, asking
  amber, unread purple"* — **false whenever the row is also unread**, and false for
  `background` and for plugin rows' unread dot (C2, C3, C4).
- *"The machines plugin's compact switcher … is removed"* — **the component is gone; its mount is
  not**, and the mount is what regressed (C1).

**Suggested fix order:** C1 (delete the header call site + `tiles`) → C2 (delete line 445) →
C5 (thread `errorMachineId` through `errorNoticePatch`, reset it in `clearTransientError`) →
C3 + C4 (one colour line each) → C6 + C7 → C10 → cleanup batch C11 / C12 / C13 (plus C8, C9 as doc-or-wiring edits).

**Guard gap worth noting:** `src/client/src/components/pointerQueryOrder.test.ts` only checks
media-query-before-base ordering. Nothing in the suite asserts that a row's rail colour equals its
dot colour, which is why C2/C3/C4 could ship under a changeset that promises exactly that
property. A source-level assertion over the shared rail block (every `.session-state.*` colour in
`sessionStateBadgeStyles.ts` has a matching rail rule and no higher-specificity `.action-row`
override) would have caught all three.
