# Round 16 — lane C (fresh-defect pass, post-fix HEAD)

Target: `refactor/plugin-architecture` @ `d5e0de1e` (fix wave `5b63f491`). Read-only.
Method: static cross-file tracing of every *producer* of a mark/class/property
against every *consumer* rule written for it, plus one throwaway Vitest probe
against real Lit 3 to settle reactive-property and `ref` semantics (probe file
deleted; `git status` shows the tree clean of it). No browser: `127.0.0.1:3099`
is down (curl exit 7), so no computed-style confirmation is claimed anywhere —
each finding states whether its certainty depends on the browser or not.

Round-15 items are not re-reported. Where a round-15 fix landed on top of a
problem it did not reach, that is called out as such (F5 below).

---

## FINDING 1 (major) — the state rail is unreachable for the state it was built for, in every list

**Anchors**
- `src/client/src/components/shared.ts:423` — the rail lives on the row: `.action-row { border-left: var(--pi-rail-width, 3px) solid transparent; … }` (row also has `border: 1px solid var(--pi-border)`, `shared.ts:372`).
- `src/client/src/components/shared.ts:427-428` — `.action-row:has(.activity-indicator.unread) .action-main, .action-row:has(.unread-ring) { border-left-color: var(--pi-accent); }`
- `src/client/src/components/shared.ts:379` — `.action-main { … border: 0; … }`, and no sheet in the repo ever gives `.action-main` a border-width (only `border-radius`: `shared.ts:318,383`, `MachineList.ts:254`; the one exception is the pending row `SessionList.ts:737`).
- Producers of the row-level `unread` class: **only** `src/client/src/components/SessionList.ts:398`. `ProjectList.ts:98`, `WorkspaceList.ts:166`, `MachineList.ts:126` emit `action-row … selected` and nothing else.
- Producers of the marks: plugin lists render `.activity-indicator.{session|terminal|unread|idle}` (`pi-web-plugins/{machines,workspaces}/browser/activityBadge.ts:42-52`); the session list renders `.session-state.{asking|running|unread|error|background|idle}` (`src/client/src/components/sessionRowIndicator.ts:69-71`). No component produces `.activity-indicator.*` inside a session row.

**Mechanism** — two independent breaks in one rule block:
1. `.action-row:has(.activity-indicator.unread)` puts `border-left-color` on **`.action-main`**, which has `border: 0`. The width is on `.action-row` (`:423`), the colour on a different, borderless element. Selector matches, nothing paints. The sibling selector in the same group (`:has(.unread-ring)`) is correctly written against the row, which is what makes the first one read as a typo rather than intent.
2. The rail knows nothing about the session vocabulary. `:424-426` name `.activity-indicator.{session,terminal,sending}`; session rows carry `.session-state.*`. So for the largest list on screen, the only states that can colour a rail are `unread` (`:431`), `archived` (`:432`) and `selected` (`:433`).

**Same state, different colour per surface** (evidence that the two vocabularies were never reconciled): unread renders purple in the session list (`sessionStateBadgeStyles.ts:37`), accent in the plugin lists (`shared.ts:439`), green when the session is idle (`sessionStateBadgeStyles.ts:31`), and its rail is accent (`shared.ts:431`); work renders accent/amber dots in the session list against the green `--pi-success` rail `shared.ts:424` reserves for work.

**Failure scenario**
- Machines/projects/workspaces: a machine (or project, or workspace) with unread work and nothing in flight renders the accent dot and **no rail** — path 1 is dead, path 2 (`unread-ring`) needs the work mark too (`activityBadge.ts:46` only adds `unread-ring` when `kind !== undefined`), and the row-level fallback `.action-row.unread` is never emitted by these three lists.
- Sessions: a session that is working or asking renders three bouncing dots and **no rail**, while the machine row *directly above it in the same panel* renders the green rail for the same underlying activity. Same state, two treatments, adjacent rows.
- The comment at `shared.ts:430` ("Rows report unread as their own class rather than a child indicator, so the rail reads it there too; the two paths cover every list") is the doc claim this finding falsifies: path A is dead, path B exists in exactly one list.

**Adjudication: TRUE**, browser-independent (CSS `border-left-color` with `border-width: 0` paints nothing is not engine-specific). Severity: major — this is the one place the design "spends colour on identity" (`shared.ts:414-421`), and it fires for neither unread nor work in three of four lists.
**Disposition**: drop the `.action-main` descendant from `:427`; add `.action-row:has(.session-state.running|asking|unread)` (or have `sessionRowIndicator` emit the rail classes the CSS already knows). Add a structural test that for each state in the rail table at `sessionRowIndicator.ts:17-23` at least one rule colours a `.action-row` border.

---

## FINDING 2 (major) — the section focus contract has two implementations; the live one dies after one phone-sheet cycle, the other is never called

**Anchors**
- `src/client/src/components/appShell/AppNavigationPanel.ts:122-129` — `focusSection()`: `machines`/`sessions` → `@query("machine-list")` / `@query("session-list")` (`:118-119`); `projects`/`workspaces` → `focusContributedNavSection()` → `section.focus()` (`:326-331`).
- `pi-web-plugins/workspaces/browser/pi-web-plugin.ts:17-18` — module-level `projectsListRef` / `workspacesListRef`; bound in `renderProjectsSection`/`renderWorkspacesSection` (`:23`, `:47`), consumed by the contributions' `focus` (`:72`, `:78`).
- `src/client/src/components/appShell/ContextSwitcherSheet.ts:47-50` — the phone sheet renders **the same contributed render functions** (`tiles: false`), so it re-binds the same module-level refs to its own instances.
- `pi-web-plugins/machines/browser/pi-web-plugin.ts:18,23,63` — the machines plugin keeps its own module-level `listRef` and contributes `focus: async () => await listRef.value?.focusSelectedOrFirst() ?? false`.
- `src/client/src/plugins/types.ts:344-349` and `src/plugin-api.ts:343-349` — `MachineSectionContribution.focus` is a documented, shipped part of the public contract.

**Mechanism, part A (dead)** — nothing ever calls a machine section's `focus`. The only call site of `.focus()` on a section contribution is `AppNavigationPanel.ts:330`, reached only for `"projects"`/`"workspaces"`; `machines` goes through `@query`. So `pi-web-plugins/machines/browser/pi-web-plugin.ts:18,63` is dead code, and the contract advertises a hook the host bypasses for the one section that implements it.

**Mechanism, part B (broken)** — probe result against real Lit 3 (`lit-html` in this repo's `node_modules`, happy-dom): when the element a `ref` points at is removed, **`ref.value` is set to `undefined`**; the other surface's long-lived element does not re-register, because its `ref` part never re-commits (same ref object, no value change). Sequence: phone width → open "Change context" sheet → sheet's `<project-list>`/`<workspace-list>`/`<machine-list>` take the module refs → close the sheet → refs clear to `undefined` → `section.focus()` returns `false` forever after. `PiWebApp.focusNavigationSection` (`PiWebApp.ts:2596-2607`) awaits that boolean and ignores it, so the user gets no focus and no diagnostic. Recovery only when the panel's section element remounts (fold/unfold, section filter).
Probe also settled the sibling question: `plain override hidden = false` yields `changed = []`, `@property({type: Boolean, reflect: true}) override hidden` yields `changed = ["hidden"]` — i.e. the pattern in `ProjectList.ts:77` / `WorkspaceList.ts:93` really does fire, and would be silently dead if the decorator were dropped (see Finding 4).

**Failure scenario** — phone with a hardware/Bluetooth keyboard: open the context sheet, close it, press the section-forward key from the top bar. Focus should land on the first project row; instead the key is swallowed. The same keys keep working for Machines and Sessions, which makes it read as flaky keyboard handling rather than a dead reference.

**Adjudication: TRUE** for part A (exhaustive call-site grep, no browser dependency). Part B is TRUE by Lit semantics verified empirically here; its *reach* is phone-width-plus-keyboard, so severity is major-by-consequence but low-by-frequency.
**Disposition**: either give the contribution refs a per-surface scope (a ref per render root, or resolve through the panel's own shadow root like machines does), or drop `focus` from `MachineSectionContribution` and stop advertising a hook no host calls. One mechanism for four sections, not two.

---

## FINDING 3 (medium) — bulk selection has exactly one row-level style, and it is dead

**Anchors**: `src/client/src/components/SessionList.ts:398` (emits `bulk-selected`), `SessionList.ts:735` `.action-row.bulk-selected .action-main { border-color: var(--pi-accent); }`. Repo-wide grep for `bulk-selected` outside tests returns only those two lines. Same root cause as Finding 1: `border-color` on `.action-main`, which is `border: 0` (`shared.ts:379`).

**Failure scenario** — enter bulk select, tap "select all" on a list of thirty sessions: every row is now selected and every row looks exactly as it did before, apart from a 16px checkbox tick. There is no row background, border, or accent rule for `bulk-selected` anywhere (`selected` and `unread` both have several; `bulk-selected` has one, dead). `SessionList.ts:757` (`.action-row.is-child .action-main { border-color: var(--pi-border-muted) }`) is dead by the same mechanism, though child rows keep other signals.

**Adjudication: TRUE**, browser-independent. Severity medium: the affordance still works, the confirmation does not read.
**Disposition**: move the declaration to `.action-row.bulk-selected { border-color: …; background: … }` next to `:433`, matching how every other row state is expressed.

---

## FINDING 4 (minor) — the "retire the search query when the section hides" rule exists in two of the three lists that need it

**Anchors**
- `pi-web-plugins/workspaces/browser/ProjectList.ts:31-39,77` and `WorkspaceList.ts:43-50,93`: `@property({type: Boolean, reflect: true}) override hidden` plus `if (changed.has("hidden") && this.hidden && this.searchQuery !== "") this.searchQuery = "";`, with a comment explaining the exact user-visible failure it prevents ("a leftover filter silently hiding rows from it reads as projects vanishing").
- `pi-web-plugins/machines/browser/MachineList.ts:22,81-98,110`: same search field, same filtering, **no `hidden` reactive property and no `updated` guard**. It is hidden the same way: `pi-web-plugins/machines/browser/pi-web-plugin.ts:24` sets `.hidden=${display.hidden}` on the mounted element, and `MachineSwitcher.ts:13-14` documents that "the phone shell keeps it mounted but hidden for keyboard navigation".

**Failure scenario** — phone accordion (or desktop panel): type `prod` into the Machines search, move to Projects, switch back to Machines. The section reopens still filtered to `prod`; what is not visible is why. Workspaces and projects were explicitly fixed against this; machines was not.

**Adjudication: TRUE** (cross-file inconsistency with an in-repo statement of intent; the fix pattern and its comment already exist two files over). Severity minor — the query stays visible with a clear button, so it is recoverable, unlike a silently-empty list.
**Disposition**: same two lines as `ProjectList.ts:38-39,77`.

---

## FINDING 5 (against round 15) — F2's symptom was never visible; the fix repaired a rule that cannot paint

Round 15 lane A recorded the amplifier as: "shared.ts:423-424 — `.action-row:has(.activity-indicator.unread) .action-main, .action-row:has(.unread-ring) { border-left-color: var(--pi-accent) }` … 每一行的左侧状态轨都被点亮成 accent" (`docs/design/research/r15-lane-a.md:28`), and the wave fixed it (`5b63f491`, `activityBadge.ts:42` now `kind ?? (present ? "unread" : "idle")`).

Pre-wave the code was `const markKind = kind ?? "unread"` (`git show 5b63f491~1:pi-web-plugins/machines/browser/activityBadge.ts:38-42`), so idle rows did carry `.activity-indicator.unread` and the `:has()` did match. But the declaration landed on `.action-main`, `border: 0` (`shared.ts:379`, unchanged since `2e5beb47`, the chips-not-cards change). The only other rail rule those lists could hit is `.action-row.unread`, which none of them emits (Finding 1). So the lit-rail-on-every-row symptom was a selector-matching observation, not a painted one; the real bug in that area is the dead rule, which survived the wave.

**Adjudication: fix correct, evidence FALSE.** The idle-class change is still right (`present` drives `?hidden`, aria, and future styling), but any follow-up that assumed the rail problem was closed by it re-opened it. Combined with Finding 1, the unread-rail work is unfinished, not finished.

---

## FINDING 6 (dead selector) — the amber rail state has no producer

`shared.ts:426` `.action-row:has(.activity-indicator.sending) { border-left-color: var(--pi-warning); }`. The only `.activity-indicator.sending` in the client is `SessionList.ts:318`, inside `.pending-session-row` (`:316`), which is not an `.action-row`; the plugin renderers can only produce `session`/`terminal`/`unread`/`idle` (`activityBadge.ts:15,42`, `statusActivityKind` returns session|terminal). So the "upload in flight" rail colour (`shared.ts:436` comments it as a real state) never paints anywhere.
**TRUE** (exhaustive grep, browser-independent). Severity cosmetic/dead-code; fix by either emitting `sending` where a client-side upload is in flight or deleting the rule and the claim.

## FINDING 7 (cosmetic) — `activity-ring` is a class nothing styles, and one docs reference has drifted

- Both plugin renderers emit `activity-ring` (`activityBadge.ts:46`, both copies, byte-identical), and no stylesheet in the repo declares `.activity-ring`. For an unread-only row the "ring" is therefore only the `box-shadow: 0 0 0 2px` halo on `.activity-indicator.unread` (`shared.ts:439`), i.e. 8px halo-dot rather than the 8px ring + 4px dot that `.unread-ring` describes (`shared.ts:441-443`). Works, but the class name promises a rule that does not exist, and it is the reason the unread rail has no `:has()` hook (Finding 1).
- `docs/design/research/phone-quality-parity.md:41,182` still lists `--pi-rail-width` as consumed-but-never-declared; still true at HEAD (only use is the `var(--pi-rail-width, 3px)` fallback at `shared.ts:423`), and its line reference is stale — the rule the doc cites as `shared.ts:419` is at `shared.ts:423` after the round-15 wave inserted rules above it.

---

## Checked and clean this round

- `?hidden=` / `hidden` hygiene: `shared.ts` `listStyles` carries the `:host([hidden]) { display: none }` companion, and every list that gets hidden by the panel (`session-list`, and the plugin lists via `adoptMachinesHostStyles`/`adoptWorkspacesHostStyles`, which append the host sheets after the static ones, so `:host([hidden])` wins) actually hides. `shared.ts:410` `.action-activity[hidden]` companion present.
- Listener ownership: every `addEventListener` in `SessionList`, `PromptEditor`, `ModalSurface`, `SettingsShortcutsPanel`, `TerminalPanel`, `WorkspaceList`, `ProjectList`, `relaysPanelElement`, `tasksPanelElement` has a matching removal in `disconnectedCallback` (or is bound to a per-instance socket/node).
- `MachineSwitcher`/`MachineList` have no `changed.has("hidden")` guard to be dead code about (round-15's suspicion in that direction was misplaced); the gap is the missing feature, Finding 4.
- Round-15 fixes still present at HEAD: idle-mark honesty, `activityBadge` wrapper `?hidden` + `[hidden]` companion, tile/path line pin, collapsed composer alignment to the conversation column, fold-button box, first-appearance surface load, prefetch machine keying and failure forget (`activityBadge.ts:38-52`, `lazySurfaces.ts`, `sessionController.ts`, `PromptEditor.ts:61-65`).

## What would falsify each finding

1/5/6: a browser computed-style showing a painted 3px left edge on an unread machine row or a working session row. Dev-server work is the cheap way to close them visually; the CSS argument itself needs no browser.
2B: a phone-width run where the sheet is opened, closed, and section-forward still focuses a project row.
3: a screenshot of a bulk-selected row that differs from an unselected one beyond the checkbox.
