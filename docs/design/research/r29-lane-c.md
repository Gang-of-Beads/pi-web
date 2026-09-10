# Round 29 — Lane C: cross-file consistency, MachineSwitcher leftovers, docs-vs-code

Repo: `/Users/hanxiao.du/Desktop/vincent/projects/pi-web` @ `refactor/plugin-architecture` (HEAD `5d09ff61`). Read-only.
Every claim below was checked against the file at the cited line; `Adjudication` is my verdict on whether it is a real defect.

---

## F1 — `MachineList.renderAdd()` is unreachable in every surface; its doc comment names a route that no longer exists
**Claim being tested:** `pi-web-plugins/machines/browser/MachineList.ts:189-194` — "*a bare 'Machines' heading disappeared and took **the only non-Settings route to adding a machine** with it*" (i.e. the heading carries an Add button so that route survives).

**Code reality:** every producer of `MachineSectionContext.display` hard-codes `withCreate: false`:
- `src/client/src/components/appShell/AppNavigationPanel.ts:275` (desktop + compact panel slot)
- `src/client/src/components/appShell/ContextSwitcherSheet.ts:59` (phone context sheet)
- `src/client/src/components/PiWebApp.ts:2890` and `:2958` (`buildMachineSectionContext("panel")` / `("sheet")`)

and the plugin gates the handler on exactly that flag:
- `pi-web-plugins/machines/browser/pi-web-plugin.ts:30` — `.onAdd=${display.withCreate && context.addMachine !== undefined ? … : undefined}`

so `MachineList.ts:197` (`if (this.onAdd === undefined) return null`) always returns null. `MachineList.ts:198` (`.section-add` button) and `MachineList.ts:112` (its call site in the heading) are dead in every shipped surface. Contrast the sibling sections, which do turn it on: `AppNavigationPanel.ts:290-291` (projects/workspaces) and `ContextSwitcherSheet.ts:50` (`withCreate: true`).

**Failure scenario:** a contributor reads the comment, believes the machines list owns an add affordance, and "fixes" heading visibility (`display.collapsible/tiles`) expecting the button to appear — it never does, because the flag is pinned off upstream in three files. Conversely, a reader-retired "add a machine on a phone" bug report is triaged as "the button exists, why doesn't it work" when there is no button: the real routes are the context chip's `+` (`AppContextSwitcher.ts:43` → `onAddMachine`) and Settings.

**Adjudication: TRUE** (dead code + a doc comment whose stated invariant is false). Severity: low-medium — no user-visible break, but the dead branch is precisely the kind of leftover the MachineSwitcher sweep was supposed to remove, and the comment actively misleads.

---

## F2 — `designTokens.test.ts`'s "hidden attribute must win" guard protects exactly one element, and misses the one it was written for
**Claim being tested:** `src/client/src/components/designTokens.test.ts:89-96` — "*The mobile shell keeps four lists mounted-but-hidden; the machine switcher that once shared that hidden mount shipped without the guard, so a phone named its machine twice*".

**Code reality:** the guard enumerates elements by scanning `src/client/src/components/**.ts` for a literal `?hidden=` / `hidden` **attribute** in a template (test lines 97-109), then requires the defining component — looked up only inside that same directory (line 114) — to carry a `:host([hidden])` rule **or** to adopt `listStyles` (lines 117-119, `usesSharedListSheet || guardsItself`). Two properties of the current code put the machine list outside that net:
1. `machine-list` is defined in `pi-web-plugins/machines/browser/MachineList.ts` — outside the scanned directory; a tag reaching line 111 would fail with "no component defines \<machine-list\>".
2. It is hidden with a **property binding** — `pi-web-plugins/machines/browser/pi-web-plugin.ts:48` `.hidden=${display.hidden}` — which the `(^|\s)\?hidden=` regex cannot see.

I executed the test's own scan to confirm the coverage set:

```
guarded tags: session-list
prop-bound hidden in pi-web-plugins/machines/browser/MachineList.ts (via pi-web-plugin.ts) -> .hidden=${display.hidden}
```

**Failure scenario:** today the behaviour is *correct* by hand — `MachineList` adopts `listStyles` through `adoptMachinesHostStyles()` (`pi-web-plugins/machines/browser/hostUi.ts`), and `src/client/src/components/shared.ts:238` carries `:host([hidden]) { display: none; }`. The guard is real but unenforced: delete `shared.ts:238` (or ship a plugin element with `display:` on `:host` and no guard) and the suite stays green while the phone renders a second, invisible-but-laid-out machine list — the exact bug the comment describes.

**Adjudication: TRUE** (test-coverage claim in the comment is false; behaviour currently correct). Severity: medium — a silent-regression hole in the one place the codebase documents as "the failure is silent". The scan should follow `.hidden=${…}` bindings and resolve definitions outside `src/client/src/components`.

---

## F3 — `errorBanner.ts` documents one producer of the "composed" prefix; three exist, two outside the machine controller
**Claim being tested:** `src/client/src/components/errorBanner.ts:60-63` — "*A composed message already names its machine … The composed prefix **is the machine controller's own; nothing else produces it***."

**Code reality:** the prefix `${name} is unavailable; reconnecting…` (matched by `/is unavailable; reconnecting/i`, `errorBanner.ts:66`) is produced at:
- `src/client/src/controllers/machineController.ts:133` (`machineDownNotice`, with detail)
- `src/client/src/controllers/machineController.ts:195` (explicit machine selection while down, no detail)
- `src/client/src/components/PiWebApp.ts:1593` (`setRemoteRouteRestoreMessage`, the non-exhausted retry-ladder sentence) — a different file, not "the machine controller"

(`PiWebApp.ts:1592` produces the sibling `… is still unavailable.` — not matched by the composed regex, so the exhausted banner is *not* treated as composed; see F4.)

**Failure scenario:** the guard exists so the rewrites at `errorBanner.ts:69-72` ("Reconnecting to the session daemon…") cannot erase a machine name. The comment points a future editor at one owner; changing the wording at `machineController.ts:133` (the named owner) leaves `PiWebApp.ts:1593` emitting the old prefix, at which point the route-restore banner starts being shortened to a generic daemon sentence and the machine name disappears — the original bug, reintroduced through the file the comment did not mention.

**Adjudication: TRUE** (comment claim falsified by code). Severity: low — no runtime defect today, all three producers currently compose the same prefix and all correctly decline a rewrite.

---

## F4 — Changeset overstates the expiry rule: the six-second timer still gates on wording
**Claim being tested:** `.changeset/banner-retirement-model.md:11-12` — "***The six-second expiry checks the retirement mark instead of guessing from the wording***".

**Code reality:** `src/client/src/components/PiWebApp.ts:1102-1103`:
```ts
if (this.state.errorRetiredBy !== RetiredBy.reply) return;
if (normalizeTransientError(error) === undefined) return;
```
Both conditions must hold. The in-code comment at `PiWebApp.ts:1096-1101` states the honest rule ("*A reply-retired message the wording layer declines to shorten … stays*"), so the drift is between the **changeset and the code**, and the changeset also contradicts the comment two lines above its own implementation.

**Failure scenario:** the retry ladder's terminal sentence — `PiWebApp.ts:1592`, "`X is still unavailable.`" — is reply-retired (`noticeFromTransport`) and `normalizeTransientError` returns `undefined` for it (the anchored rules at `errorBanner.ts:97,102` cannot match a message that begins with a machine name). A release reader acting on the changeset ("expiry no longer guesses from wording") would expect that banner to withdraw in six seconds; it stays until the machine answers or the reader dismisses it. Verified there is no accidental rewrite either: the gateway detail arrives as `Remote machine unavailable (connect ECONNREFUSED …)`, which misses `unavailable: connect (enoent|econnrefused)` at `errorBanner.ts:69` (colon, not parenthesis).

**Adjudication: TRUE** (documentation/changeset drift; code behaviour is the intended one). Severity: low.

---

## F5 — "Every row reads as one state at any distance" does not hold for a healthy machine row
**Claim being tested:** `.changeset/banner-retirement-model.md:15-17` — "*The state rail now wears the **exact colour the row's own dot wears** … so a row reads as one state at any distance*".

**Code reality:** the rail membership for machine rows is `src/client/src/components/shared.ts:456`:
```ts
.action-row:has(:where(.machine-status.offline, .machine-status.error)) { border-left-color: var(--pi-danger); }
```
An **online** machine row wears a green dot (`pi-web-plugins/machines/browser/MachineList.ts:264-265`, `.machine-status.online { color: var(--pi-success) }`) and has no rail membership, so `.action-row` keeps `border-left … transparent` (`shared.ts:409`). Every other vocabulary has a "healthy/working" member: `.activity-indicator.session` → success (`shared.ts:446`). The narrower intent is documented at `shared.ts:452-455` ("*offline and error wear the danger dot … a down machine must not scan like a healthy idle one*") — i.e. the gap is deliberate in the code comment and contradicted by the changeset's blanket sentence.

**Failure scenario:** a sidebar with several online machines shows rails only on the down ones; nothing marks the healthy ones at scanning distance, so "one state at any distance" reads as broken-by-design only for the surface the plugin exists to serve. Any future "rail covers every row" change that assumes parity will find no membership to extend for online machines.

**Adjudication: TRUE** (claim overreach against both the CSS and its own comment). Severity: low (design intent, not a crash).

---

## F6 — The phone context sheet re-imposes the "≥ 2 machines" rule the panel deliberately retired
**Claim being tested:** `src/client/src/components/appShell/AppNavigationPanel.ts:499-505` — "*It used to appear only with a second machine … That also hid the only place outside Settings where the local machine can be renamed or another machine added, so a single-machine user could not find 'devices' at all*" (the rule was relaxed to `machines.length > 0`, `AppNavigationPanel.ts:506-508`).

**Code reality:** `src/client/src/components/appShell/ContextSwitcherSheet.ts:54` — `if (this.machineCount() < 2) return null;` restores the removed threshold on the compact path. `machineCount()` is the full machine list (`ContextSwitcherSheet.ts:78`), so with exactly one machine the sheet renders no machine group at all — while `shouldShowMachinesSection` would show it.

**Failure scenario:** fresh install on a phone (one local machine). The context sheet — documented as "where every level is listed and the current one is marked" (`AppNavigationPanel.ts:216-219`) — lists Projects and Workspaces and skips the machine level entirely; renaming the local machine or adding a second one is Settings-only, which is the exact outcome the quoted comment says was fixed.

**Adjudication: TRUE** (documented invariant violated in the sibling surface). Severity: low-medium — cosmetic-discoverability, not a broken control.

---

## F7 — Living design docs still describe components that no longer exist, and cite line numbers past end-of-file
Verified with a script that resolves each `file:line` citation in `docs/*.md` and `docs/design/*.md` against the tree (research logs under `docs/design/research/**` excluded — those are point-in-time records).

| Citation | Claim | Reality | Verdict |
|---|---|---|---|
| `docs/capability-map-draft.md:231`, `:247` | capability served by `components/MachineSwitcher.ts` | file deleted in `b0bce2a0` (the MachineSwitcher removal this round audits) | **TRUE** stale |
| `docs/capability-map-draft.md:31` | `appShell/AppContextBar.ts:297` | file is **110** lines | **TRUE** out of range |
| `docs/capability-map-draft.md:49` | "Switch machine … context bar's pointer path", `AppContextBar.ts:22-23,47,54` | `AppContextBar` renders panel toggle + session title + working indicator only (`AppContextBar.ts:26-60`); the machine step lives in `AppContextSwitcher.ts:43` | **TRUE** wrong file |
| `docs/capability-map-draft.md:91`, `:144` | `appShell/AppContextBar.ts:126-156` / `:126-136` | 110-line file | **TRUE** out of range |
| `docs/capability-map-draft.md:37` | `components/appShell/AppMobileToolSheet.ts:58` | file deleted (the tool sheet this round's changeset removes the last of) | **TRUE** missing file |
| `docs/capability-map-draft.md:76` | `components/WorkspaceFileViewer.ts:141,156-161` | file deleted (files moved to the core plugin) | **TRUE** missing file |
| `docs/capability-map-draft.md:80-83,163,234` | workspace-goal capabilities served by `GoalPanel.ts:55-65/74-90/74-90/…` | `GoalPanel.ts` gone; `docs/design/goals-plugin-retirement.md` documents the retirement, the capability map was never updated | **TRUE** missing file |


MachineSwitcher leftover sweep, for the record: `grep -rn "MachineSwitcher\|machine-switcher" --include=*.ts src pi-web-plugins` returns nothing but a historical mention in `designTokens.test.ts:93`; `AppNavigationPanel.ts` contains no switcher reference; the only docs hit is the `phone-navigation-model.md` row. **The code is clean; the docs are not.**

**Adjudication: TRUE** for all ten stale rows above; `docs/design/element-native-vs-plugin.md:32` checked clean. Severity: low individually, medium in aggregate — these are the maps a new contributor is handed, and the one doc that documents the phone navigation model still describes a component deleted two rounds ago.

---

# Adjudicated FALSE — checked and holding (so nobody re-litigates them)

1. **`machinesVisibleForNavigation()` ignoring `machinesCollapsed`** (`AppNavigationPanel.ts:256-257` vs `:260-261`) looks like the bug this lane flagged before. It is not: the keyboard ladder ends in `PiWebApp.focusNavigationSection` (`PiWebApp.ts:2694-2704`), which calls `navigationSections.expand(section)` and then `await this.updateComplete; await nextFrame();` **before** `focusSection`, so the target list is un-hidden before focus. The parameter's job is contribution (`machinesSectionContributed()`, `AppNavigationPanel.ts:252-254`), not visibility — the name is just misleading. FALSE (nit: rename to `machinesContributedForNavigation`).
2. **Rail specificity arithmetic** — `shared.ts:419-421` claims all `:has()` memberships are (0,1,0) and the `archived`/`selected` overrides are (0,2,0) and therefore win. Correct: `:where()` inside `:has()` contributes nothing; `shared.ts:457-458` beat `:439-456`. FALSE.
3. **`.action-row.unread` rail** — `shared.ts:421-426` claims round-18 removed the (0,2,0) unread rail rule so an unread+asking row keeps the amber dot's colour. Confirmed: the only `.action-row.unread` rule left is text emphasis (`SessionList.ts:726`), and the row class never matches a descendant-only `:has()`. FALSE.
4. **`.activity-indicator.sending` "has no rail"** (`shared.ts:462`) — the pending row is `div.pending-session-row` (`SessionList.ts:323-327`), not `.action-row`, so `shared.ts:409` never applies. FALSE.
5. **Every rail/dot membership has a live producer** despite being composed from template literals: `.session-state.*` via `sessionRowIndicator.ts:69-71` (kinds enumerated at `:33`), `.activity-indicator.unread` via `activityBadge.ts:35` (`markKind = kind ?? "unread"`), `.machine-status.*` via `MachineList.ts:147`. No dead rules. FALSE.
6. **`.action-activity` hidden guard** — `activityBadge.ts:42` sets `?hidden` on an element that carries `display: grid` (`shared.ts:389`); the author override `shared.ts:393` (`.action-activity[hidden] { display: none; }`) restores it. FALSE (correct, same class as `shared.ts:238`).
7. **`reportTransportReachable` machine scoping** — `src/client/src/api/transportHealth.ts` scopes every voucher by `machineIdFromUrl`, and web-owned successes (undefined machine id) correctly fail to disprove a machine-scoped claim, exactly as `.changeset/banner-retirement-model.md:8-10` claims. One residual wart, adjudicated not-a-bug: `src/client/src/api/http.ts:50` reports reachability for *every* resolved response, including a gateway `502 Remote machine unavailable` (`src/server/web/machines/machineProxyRoutes.ts:367`) whose URL carries the *down* machine's id — but the `clearErrorPatch()` that follows is immediately over-written by the catch path (`machineController.ts:154,179`), so the visible effect is none, not a flicker. FALSE.
8. **`noticeForReader` at `sessionController.ts:1701`** (`failPendingSessionStart`) — flagged as a possible bypass: an offline `TypeError` during session start becomes reader-retired and never self-heals. Verified benign: the composed text `"Failed to start session: Failed to fetch"` also fails the anchored rule at `errorBanner.ts:97`, so reply-retirement would not have auto-dismissed it either; and an operation outcome the user explicitly started should stay. FALSE (intentional; the retirement model is about evidence, and here the operation — not the link — failed).
9. **MachineSwitcher leftovers in code** — none (see F7). `navigationSections.toggle("machines")` is, however, now only reachable through `toggleCollapsed` on a `collapsible: false` context (`AppNavigationPanel.ts:276`), i.e. unreachable; `toggleNavigationSection`'s machines arm is dead. **TRUE, cosmetic** — folded into F1's "dead leftovers" bucket rather than counted separately.
