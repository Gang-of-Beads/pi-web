# Round 31 — lane C (structural cross-file consistency, docs-vs-code, notice-model bypasses)

HEAD under review: `31560179` ("Start convergence round 31"), branch `refactor/plugin-architecture`.
Method: static read of the notice/banner surface (notice.ts, errorNotice.ts, errorBanner.ts,
bannerHold.ts, transportHealth.ts, http.ts, clients.ts, appState.ts, PiWebApp.ts error machine,
machineController.ts), the navigation shell (AppNavigationPanel, AppContextSwitcher,
ContextSwitcherSheet, navigationState, SessionList), the machines/workspaces plugins
(MachineList, MachineDialog, hostUi ×2, ProjectList, WorkspaceList, ProjectDialog), the
machine routes/services, plus every `.changeset/*.md` and the round-17…round-30 triage docs.
No tests were run; every claim below is a `file:line` reading with a written failure scenario.

**Verdict: the lane is not clean.** Two findings are new to the ledger and both sit in the
self-update surface (F1, F2), one is a new *half* of an item the ledger already carries (F4),
and one is an undocumented host↔plugin layout coupling that a test currently freezes in place
(F3). The notice-retirement model itself holds: no producer bypasses the seam.

---

## F1 — The self-update "applying" banner has no exit. TRUE (Medium, NEW)

`src/client/src/components/PiWebApp.ts:891-908` (`applySelfUpdate`), rendered at
`src/client/src/components/PiWebApp.ts:947-956`.

`selfUpdateApplying` is set `true` at `:893` and reset to `false` on exactly two paths:
`!result.started` (`:897`) and a thrown request (`:905`). On `started: true` the comment says
"the applying flag stays up until then" — but nothing ever writes it back. The applying branch
(`:950-956`) renders three blinking dots and **no Skip, no Reload, no dismiss**; the Skip button
only exists in the non-applying branch (`:964`).

The only thing that removes it is a later `refreshSelfUpdate()` (`:878-888`) answering
`available: false`, which itself is gated twice: it is triggered only by opening a session, and
its own 60-second cooldown (`:879-880`) is set even on failure.

Minimal failure scenario: reader taps "Update now"; the apply route answers `started: true`; the
server restarts and the socket reconnects, so the page is never reloaded. If the restart lands
on the same version (rollback, `git` remote unchanged, npm resolution pinned), or the restart
fails after `started` was returned, `selfUpdate.available` stays true forever. The blinking
"正在更新 pi-web…" strip occupies the top of the screen permanently with no control to dismiss
it — the one banner in the app that a reader cannot get rid of.

Cross-check: `.changeset/round-thirty-own-seams.md`, `banner-retirement-model.md` and
round-18 item 6 all discuss the self-update *failure* notice's retirement mark (fixed, see
clean list C6), and none of them touches the applying banner's lifetime. Nothing in
`docs/design/review-triage-uiux-round*.md` mentions it. Not ledgered.

## F2 — Tapping "Update now" never re-checks client freshness, which is the one case `renderStaleClientBanner` exists for. TRUE (Medium, NEW)

`src/client/src/components/PiWebApp.ts:1052` and `:644` are the only two call sites of
`checkClientFreshness` (boot/connect, and `visibilitychange → visible`). `applySelfUpdate`
(`:891-908`) does not call it, and no socket-reconnect hook does (`grep onSocketReconnected`
returns nothing in PiWebApp.ts).

The doc comment at `:920-928` states the reason the banner exists: "The tab keeps running the
bundle it loaded, however many times the server underneath is upgraded; every client-side fix
shipped in between is invisible here, and gets reported as still broken."

Minimal failure scenario: reader on a desktop taps "Update now". At that instant
`staleClientServerVersion` was computed at connect time and is `undefined` (versions matched).
The server restarts into the new version, the socket reconnects, the tab never loses visibility,
so nothing re-runs the version probe. The reader keeps executing the old bundle — while having
personally caused the upgrade whose fixes they now cannot see. This is the highest-probability
path to the exact symptom the banner was written to catch, and it is the one path that does not
trigger the check. The applying banner from F1 covers the screen in its place, claiming work is
still in progress.

Minimal fix is one line in the `started: true` path (re-probe once the link is back), which also
gives F1 its exit condition.

## F3 — The navigation shell sizes a contributed section by its **custom-element tag**, which the plugin contract does not reserve. TRUE (Medium-low, NEW)

- `src/client/src/components/appShell/AppNavigationPanel.ts:494`
  `machine-list, project-list, workspace-list, session-list { flex: 1 1 auto; min-height: 0; overflow: hidden; }`
- `src/client/src/components/appShell/ContextSwitcherSheet.ts:97`
  `.sheet-body machine-list, .sheet-body project-list, .sheet-body workspace-list { flex: 0 0 auto; min-height: auto; }`
- Contract: `src/plugin-api.ts:281-295` reserves the *ids* (`projects`, `workspaces`; `machines`
  at `:340-350`) and leaves `render: (context) => TemplateResult` free — the root tag is not part
  of the reserved vocabulary.
- The three tags are chosen by the built-in plugins alone:
  `pi-web-plugins/machines/browser/MachineList.ts:18`, `pi-web-plugins/workspaces/browser/ProjectList.ts:12`,
  `pi-web-plugins/workspaces/browser/WorkspaceList.ts:32`. None of the three declares its own
  outer sizing — `MachineList.ts:261` is `:host { display: block; min-width: 0; }` and
  `ProjectList` has no `:host` rule at all.
- `src/client/src/components/appShell/AppNavigationPanel.test.ts:41` asserts the selector string
  verbatim, so the test freezes the enumeration instead of guarding against the drift.

Minimal failure scenario: a third-party plugin registers `id: "projects"` and renders
`<acme-projects>`. In the phone sheet it gets the default `flex-shrink: 1` inside the
`.sheet-body` column, which is exactly the bug the comment at `ContextSwitcherSheet.ts:94-96`
records as fixed ("one scrollable surface became three squeezed ones — a second machine
rendered as an 8.9px sliver that read as a rendering artefact, not a row"). The sliver returns
for any non-builtin tag. On desktop the same omission leaves the body with no bounded height, so
its internal scroller never engages and the list grows past the panel.

Both surfaces pass `deep`-query tests today because the built-in tag names are used everywhere.

## F4 — The collapse-toggle chain: the ledger's item is real, and its **session-list leg is larger than recorded**. TRUE (Low-Medium, PART-LEDGERED)

Ledgered since round 26 (`review-triage-uiux-round26.md:64-68` "the wiring is dead but the
collapsed state still steers the compact panel"), carried through round 27, 29 and 30
(`round30.md:65`). What follows confirms it is still open at this HEAD **and** adds a leg the
ledger has never named.

Chain as it stands, end to end:

1. `display.collapsible` is hardcoded `false` at all six producer sites:
   `AppNavigationPanel.ts:275`, `:290`; `ContextSwitcherSheet.ts:50`, `:59`;
   `PiWebApp.ts:2895` (nav context), `:2963` (machine context).
2. `pi-web-plugins/machines/browser/MachineList.ts:205` early-returns `<span>Machines</span>`
   when `!collapsible`, so the toggle button at `:209` is never drawn and its
   `onToggleCollapsed` never fires (the machine total at `:209` never draws either).
3. `AppNavigationPanel.ts:276` (`toggleCollapsed → onToggleMachines`) is therefore unreachable,
   as is the `PiWebApp.ts:2279` handler it reaches.
4. `PiWebApp.ts:3008` (`toggleCollapsed: () => { this.navigationSections.toggle("machines"); }`)
   is overridden by *both* consumers — `AppNavigationPanel.ts:276` and
   `ContextSwitcherSheet.ts:64` (`toggleCollapsed: () => undefined`) — so it is dead on a second
   count.
5. **New leg.** `AppNavigationPanel.renderSessionList(collapsible, …)` is called with the literal
   `false` at both call sites (`:172`, `:239`). Inside it, `:371`
   `.collapsible=${collapsible && this.collapsible}` is therefore always false, `:372` always
   false, and `:373` unreachable. Consequences: `AppNavigationPanel.collapsible` (`:56`) is a
   no-op, so the `.collapsible=${true}` the host passes at `PiWebApp.ts:2291` does nothing; and
   `onToggleSessions` (`:74`, wired at `PiWebApp.ts:2308` to `navigationSections.toggle("sessions")`)
   is unreachable. `SessionList.ts:273` always takes the plain-heading branch, so the whole
   collapsible heading in `SessionList.ts:285-295` — including its `section-count` — never draws.
   No CSS keys off `[collapsible]` (the property is `reflect: true` at `SessionList.ts:60` and
   `AppNavigationPanel.ts:56`, so the reflected attribute is a write-only signal), and no test
   covers any of it.
6. `machinesCollapsed` / `sessionsCollapsed` are **not** dead: they are read by
   `compactVisibleSection()` (`:261-264`) and steer which section is shown. That is the asymmetry
   the ledger already records, and it still holds.

Net new statement for the owner: the dead surface is not just the machines leg — it is the
`collapsible` concept across all four sections, six hardcoded `false` producers, one hardcoded
`false` argument, one plugin-contract field (`plugin-api.ts:232`, mirrored at
`src/client/src/plugins/types.ts:221`) with no live producer anywhere in the tree, and two host
callbacks (`onToggleMachines`, `onToggleSessions`) that cannot fire.

## F5 — The machines section is discoverable from one machine on desktop and from two on phone. TRUE, but already ledgered (Low, DOC-DRIFT)

- `src/client/src/components/appShell/AppNavigationPanel.ts:507` `shouldShowMachinesSection` → `machines.length > 0`.
- `src/client/src/components/appShell/ContextSwitcherSheet.ts:54` `renderMachineGroup()` → `if (this.machineCount() < 2) return null;`

History, because it matters to the reading of the docs: `> 1` was deliberately relaxed to `> 0`
in `dd95229c`, with the reason written into the doc comment — "a single-machine user could not
find 'devices' at all". `.changeset/sheet-machines-slot.md` was written **later**
(`fe4c113d`, +14 days) and still says "The group still hides itself below two machines", phrased
as though nothing had changed. No changeset records the relaxation. So the reader of the
changeset history concludes ≥2 is the standing policy; the reader of the panel sees ≥1.

The rationale that justified ≥1 on desktop applies with more force on the phone, where the sheet
is the only scope switcher in the compact header. Mitigation, which caps this at Low: a phone
reader can still reach Settings → Machines (`SettingsDialog.ts:180` list row, `:246-259` panel),
and `sheet-machines-slot.md` documents the rule, so this is a divergence with a written reason
rather than an accident.

Ledger status: `round30.md:62` already lists "Phone add-machine affordance; the context sheet's
≥2-machines rule" under *Pending with the owner*. **Do not re-file as new** — file as: the
pending item should be closed by aligning the sheet to `> 0`, and the changeset line corrected,
because the desktop rationale is written down and applies to both surfaces.

## F6 — `transportHealth.ts` documents the opposite of what its own URL rule does. TRUE, but already ledgered in substance (Low, DOC-DRIFT)

`src/client/src/api/transportHealth.ts:25-29` promises that machine ids come back `undefined`
for web-owned URLs, "not even the local one, whose daemon can be down while the web process
serves 200s". `machineIdFromUrl` at `:31-41` matches `/\/machines\/([^/]+)/`, and the local
machine's real id **is** the string `local` (`src/server/web/app.machines.test.ts:13,48`), so
`api/machines/local/health` (`src/client/src/api/clients.ts:124`) returns `"local"` and vouches
for machine `local`. `reportTransportReachable` fires on every response **including 5xx**
(`src/client/src/api/http.ts:45-50`, comment at `:48-49` is explicit), and the listener clears
the claim (`PiWebApp.ts:1018` → `:1063-1077`). Combined with `machineService.ts:148+` answering
an offline machine with HTTP 200 + `ok:false`, a local health poll that proves nothing about the
daemon withdraws a genuine link complaint about `local`.

This is an instance of the round-30 item already pending with the owner
(`round30.md:58-60`, "the gateway's failing answers … vouch for the machine they were addressed
to"), and of the round-24 mixed-local-namespace item (`round24.md:48-49`, "the URL rule cannot
say so"). The only new content is *where* the wrongness lives: the module's own docstring is the
artifact asserting immunity, which is plausibly why six rounds of audit kept re-deriving the
behaviour and re-deferring it. A one-line doc correction is available independently of the
owner's vocabulary decision.

---

## Clean-lane confirmations (checked, no finding)

- **C1 — No producer bypasses the notice seam.** A sweep for bare error writes outside
  `errorNoticePatch` / `noticePatch` / `clearErrorPatch` finds only `authController.ts:152`,
  `:290` (both `state.authDialog.error`, dialog-local), plus the `sessionCleanupDialog` /
  settings panel fields. Round-18 item 8's claim still holds at this HEAD.
- **C2 — The `:has()` rail rules agree with the arbiter.** Source order in `shared.ts` matches
  the priority in `sessionRowIndicator.ts` (asking > running > unread > error > background >
  idle). `.session-state.running` having no colour rule of its own in
  `sessionStateBadgeStyles.ts` is by design: a running row draws `.state-dots`, not a solid
  badge. Matches the round-28 errata, not contradicts it.
- **C3 — Machine status vocabulary is consistent.** The plugin's
  `"online" | "offline" | "error" | "unknown"` maps to `--pi-dot-*` in `MachineList.ts`, and
  offline/error resolve to danger in both the dot and the rail. `PiWebApp.ts:2955` folds health
  into `status` exactly as `plugin-api.ts:297` documents.
- **C4 — The touch contract holds across the plugin boundary.** Re-running the
  `interactiveSurfaceContract.test.ts` predicate over `pi-web-plugins/**` by hand (the test only
  walks `src/client/src/components/**`) finds zero offenders: all ten plugin files that render a
  control and own CSS either carry the declarations or adopt them through
  `adoptMachinesHostStyles` / `adoptWorkspacesHostStyles`. The stated scope ("every component")
  is wider than the tested scope, but the outcome is currently correct.
- **C5 — `reportTransportReachable` has exactly four producers, all intentional**:
  `http.ts:50` (every fetch), `clients.ts:392`, `:415` (the two manual XHR paths),
  `workspaceUploads.ts:152` (XHR 2xx). No path reports reachability without a response.
- **C6 — Self-update *failures* do go through the seam** as reader-retired
  (`PiWebApp.ts:901`, `:906` use `noticeForReader`); round-18 item 6 is still true. F1/F2 above
  are about the success path and the banner's lifetime, not the retirement mark.
- **C7 — Round-18's deferred `link.live` item is genuinely closed**: the identifier no longer
  exists anywhere in `src/`, consistent with round-21's "superseded — the dead proactive branch".
- **C8 — `MachineSwitcher` removal left no host-side residue.** No file, no import, no
  `machinesCollapsed`-adjacent leftover in `AppNavigationPanel`; the `.machine-status.*` rules in
  `shared.ts` are still consumed by `MachineList.ts`. Round-18 item 3's removal is complete.
- **C9 — Machine-scoped upload routes are correctly scoped.** `workspaceFileWriteUrl`
  (`src/client/src/api/urls.ts:24-30`) produces a `/machines/<id>/` path, so the round-30 B-4
  upload finding stays closed.
- **C10 — "X is still unavailable." rendering permanently red is by design**, not a
  normalisation miss: the exhausted-ladder wording deliberately fails `normalizeTransientError`,
  and `scheduleTransientErrorDismissal`'s own comment (`PiWebApp.ts:1085-1092`) says a permanent
  failure is never expired. Consistent with round-29's honest-ladder changeset.

## Suggested disposition

| # | Severity | Ledger | Action |
|---|----------|--------|--------|
| F1 | Medium | new | Give the applying banner an exit (timer/timeout, or reset the flag when a later status read disagrees) |
| F2 | Medium | new | Re-probe client freshness after a self-update starts; one line in the `started: true` path |
| F3 | Medium-low | new | Size contributed section bodies by slot container (a wrapper element or `:scope > *`), not by tag; `AppNavigationPanel.test.ts:41` needs reworking with it |
| F4 | Low-Medium | ledgered r26 | New leg to add to the owner's item: the `collapsible` concept is dead across all four sections, not just machines |
| F5 | Low | ledgered r30 | Close by aligning `ContextSwitcherSheet.ts:54` to `> 0`; correct `.changeset/sheet-machines-slot.md` |
| F6 | Low | ledgered r24/r30 | Doc correction only, independent of the pending vocabulary decision |
