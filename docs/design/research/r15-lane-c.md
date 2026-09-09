# Round 15 — Lane C: convergence-round-15 fix verification (commit 5b63f491)

Scope: READ-ONLY re-verification of the nine round-15 fixes (wave commits
d7018c18..861a4762 plus the fix commit 5b63f491) on
`refactor/plugin-architecture` @ 5b63f491. Fix commit touches 11 files;
`.js` plugin bundles untouched. Evidence: full source reads, diff review,
grep sweeps, full vitest suite (603 files / 5205 passed / 5 skipped, green).

## Verdict summary

| # | Round-15 fix | Holds? |
|---|--------------|--------|
| 1 | `.working[hidden]` companion (AppContextBar) | TRUE (untested) |
| 2 | `.compact-working[hidden]` + `.compact-fold` real box | TRUE (dead decl left) |
| 3 | Idle rows carry no `unread` class (both plugin copies) | TRUE |
| 4 | `.action-activity[hidden]` companion, tiles variant check | TRUE (untested) |
| 5 | `.list-body.tiles small` line-height pinned | TRUE (cosmetic nit) |
| 6 | Collapsed composer aligned to chat column | TRUE |
| 7 | Session-tree load moved out of render (loop) | TRUE (misattributed in message) |
| 8 | Prefetch merge keyed to hovered machine | TRUE (untested) |
| 9 | Failed prefetch forgotten (retry possible) | TRUE |
| 9b| Failure banner retires on successful retry | **FALSE — dead branch** |

---

## FINDING 1 (TRUE, medium-low) — the failure-banner invalidation branch is unreachable; the changeset ships an undelivered claim

- **Code**: `src/client/src/components/lazySurfaces.ts:31-43` (`loadSurface`),
  `src/client/src/components/PiWebApp.ts:1739-1743`.
- The fix adds, in `openLazySurface`:
  `if (first === undefined && failure !== undefined && this.state.error === failure) this.setState({ error: "" })`.
- **`loadSurface` never returns `undefined`.** The `loads` map's only writer is
  `trackLoad` (`lazySurfaces.ts:23-27`), which always stores a `Promise<void>`;
  `loads.get()` therefore returns a Promise or nothing, and every path of
  `loadSurface` returns a Promise. The declared `Promise<void> | undefined`
  return type is fiction — it only exists to feed the branch above, and it
  forces the pointless `?.` in `warmLazySurfaces` (`lazySurfaces.ts:73`).
- **Failure scenario (what the changeset promises vs. what happens)**:
  the session-tree chunk fails (deploy swap mid-session, flaky network) →
  `trackLoad`'s catch (`lazySurfaces.ts:24-26`, attached *before* the caller's
  handler, so the delete runs first) **removes the map entry**; `openLazySurface`'s
  catch then sets the persistent banner ("Session tree could not load… reload to
  get it." — matches no `isTransientError` pattern, `errorBanner.ts:24-27`, so it
  sticks). User closes and reopens: `loadSurface` starts a **fresh load**
  (`first` = new Promise, not `undefined`) which succeeds — the dialog works,
  but the stale banner still claims the tree is broken until manually dismissed
  or incidentally cleared (e.g. selecting another session,
  `sessionController.ts:544`). The branch meant to retire it can never run.
- **Contradicted by the repo's own test**: `lazySurfaces.test.ts:50-56`
  ("forgets a failed load so the next open can retry") pins exactly the
  delete-on-failure semantics that make the invalidation branch dead.
- Adjudication: **TRUE**. Not a user-visible regression (pre-fix behavior was
  identical), but dead code plus a published claim: `.changeset/round-fifteen-fixes.md`
  and the commit body both state "a load-failure banner that retires itself when
  a retry succeeds". Minimal honest repair: clear `state.error` in a
  `first.then(...)` success handler when it still equals `failure`, or drop the
  `| undefined` union, the branch, the `?.`, and the claim.

## FINDING 2 (TRUE, misattribution) — the loop is genuinely gone, but not because "a settled load schedules nothing"

- Commit body / changeset: "The load now fires when the dialog first appears,
  outside render, **and a settled load schedules nothing**." The bolded half is
  false: `PiWebApp.ts:1737` — when `first !== undefined` (every warm or
  previously-successful surface; `warmLazySurfaces` makes this the common case)
  the code still attaches `.then(() => this.requestUpdate())`, i.e. a settled
  load schedules one extra render per call. Harmless (bounded, one per open —
  Lit coalesces), but it is precisely what the message says cannot happen.
- What actually kills the HEAD loop is elsewhere and verified:
  `renderSessionTreeNavigator` (`PiWebApp.ts:2667-2670`) is now pure render, and
  the only load trigger is `willUpdate` (`PiWebApp.ts:661-666`) with the
  one-shot `treeDialogAnnounced` guard, reset when `state.treeDialog` goes
  undefined. Re-entry through render is structurally impossible now.
- Upgrade-race double-checked: rendering `<session-tree-navigator>` before the
  module defines is safe — `@lit/reactive-element` 2.1.2 re-applies
  pre-upgrade own properties through the accessors on construction
  (`reactive-element.js:546`), and the post-load `requestUpdate` re-renders.
- Adjudication: fix **TRUE**, message claim **FALSE** (same root cause as
  Finding 1: the dead branch was the intended "schedules nothing" mechanism).

## FINDING 3 (TRUE, minor) — the cascade fixes are correct but the tests still "assert the attribute", which was round 15's original complaint

- `.working[hidden] { display: none; }` (`AppContextBar.ts:89`, 0-2-0 beats
  `.working`'s `display: inline-flex`, `:90`, 0-1-0) — correct.
- `.action-activity[hidden] { display: none; }` (`shared.ts:407-408`) — correct,
  and the tiles override `.list-body.tiles .action-activity` (`shared.ts:325`,
  0-3-0) sets `position/top/transform/right` only, never `display`, so it cannot
  re-show a hidden wrapper. No `display: contents` anywhere in client sources.
- `.compact-working[hidden]` (`AppNavigationPanel.ts:493`) present.
- **But no test pins any of the three rules** (grep across `*.test.ts`: zero
  hits for `working\[hidden\]` / `action-activity\[hidden\]` /
  `compact-working\[hidden\]`). `AppContextBar.harness.test.ts:76` still asserts
  `hasAttribute("hidden")` — the exact attribute-level assertion class that let
  the original bug through — and the new `idleMarkHonesty.test.ts` covers only
  the badge class structure of the machines copy, not the CSS. The repo has
  established CSS-text-pinning precedent (`composerRoom.test.ts`,
  `readingEdge.test.ts`, `designTokens.test.ts`); one regex assertion per rule
  would close this. Adjudication: **TRUE finding** (test-coverage inconsistency,
  low severity, all three fixes currently correct in CSS).

## FINDING 4 (FALSE comment, pre-existing but contradicted by the rewrite) — "awaited this time" comments vs. fire-and-forget reality

- `lazySurfaces.ts:3-11`: "again - **awaited this time** - at the moment
  something asks to open them, so a cold open **waits for its own module**…
  Opening awaits the load rather than rendering an empty frame: a dialog that
  appears blank is a lie about its contents".
- `PiWebApp.ts:1747-1749` (`openSettings`): "**The dialog's module is loaded
  before it is shown.** Rendering the element first would put an empty frame on
  screen…"
- Reality after this very commit: `openLazySurface` is explicitly
  fire-and-forget (`void` + `.catch`, `PiWebApp.ts:1733-1745`), never awaited
  by any caller; `openSettings` sets `settingsOpen = true` synchronously and
  `<settings-dialog>` (`PiWebApp.ts:3901`), `<quick-switcher>` (`:3865`) and
  `<session-tree-navigator>` (`:2667`) all render from state flags before the
  custom element is defined — i.e. the blank frame the comment forbids is the
  designed behavior, papered over by `warmLazySurfaces` idle pre-warming.
- The fix commit rewrote the comment inside `openLazySurface` and left these
  two directly contradicting comments intact one file over. Adjudication:
  **TRUE doc-vs-code conflict** (documentation-level; no runtime effect).

## FINDING 5 (TRUE, minor) — `.compact-fold` keeps a declaration its own comment calls dead

- New rule `AppNavigationPanel.ts:502`:
  `.compact-fold { box-sizing: border-box; width: var(--pi-panel-header-control-height); padding: 0; }`.
- The comment explains the *old* `padding: 0` was dead because
  `.compact-header-action` (`:508`, same specificity, later source) sets
  `padding: 0 var(--pi-space-4)`. That is still exactly why the **new** rule's
  `padding: 0` is also dead — the cleanup removed the problem in prose but kept
  the dead declaration in the rule. Geometry verified otherwise: width
  resolves to 44px (`index.html:95`), border-box, glyph `var(--pi-dot-md)`=8px
  (`index.html:114`) centered by `inline-flex; justify-content: center;
  min-height: var(--pi-control-height-touch)` (`:508`) — square 44px hit box,
  comment's "8px glyph in a 24px pill" historical math checks out. Adjudication:
  **TRUE**, cosmetic/dead-code only.

## FINDING 6 (TRUE, minor) — no test coverage for the prefetch fixes at all

- `grep prefetchSession src/client/src/**/*.test.ts` → zero matches. The r15
  fix changed the merge key (`sessionController.ts:1919-1924`,
  `machineSessionKey(machineId, session.id)` — verified identical format
  `${machineId}:${sessionId}` to `sessionCacheKey`, `:1537-1539`, so the
  hover/click cache now hits) and added `forget` on failure (`:1921,1927`).
  Neither is pinned; a regression to `this.sessionCacheKey(session.id)` — the
  original bug, misfiling machine A's transcript under `B:${id}` when the
  selection changed mid-flight — would pass CI silently. Similarly, no test
  covers `openLazySurface`/the willUpdate trigger, so the render-loop class of
  regression is also unpinned. Adjudication: **TRUE** (test-gap finding, low).
  Note: the r15 notes mention "sessionDetailPrefetchForgetCauses"/signal
  wiring — there is none (no AbortController); the dedup-set delete in `.catch`
  is the entire invalidation mechanism. Retry-on-next-hover does work; the
  in-flight request itself is not cancelled. If a prior round promised signal
  plumbing, that note was inaccurate, not the code.

## FINDING 7 (cosmetic) — `.list-body.tiles small` fix leaves a double space (`;  line-height: 1.3;`,
`shared.ts:324`); the pin itself is correct: `line-height: 1.3` makes the 2.6em
min/max-height equal exactly two clamped lines, matching the sibling
`.workspace-primary-label` convention.

---

## Fixes verified TRUE (with evidence)

1. **Idle working dots hidden**: template toggle `?hidden=${!this.isWorking}`
   (`AppContextBar.ts:61`) + `.working[hidden]` (`:89`). Cascade analysis holds
   for `:where(.css-request-layer)`-free shadow CSS. `AppContextBar.test.ts:62`
   min-height assertion unaffected (rule untouched).
2. **Idle rows no longer light the rail**: `markKind = kind ?? (present ?
   "unread" : "idle")` in both plugin copies, which are **byte-identical**
   (`diff` empty). Idle+read rows get `.activity-indicator.idle` (no CSS, hidden
   wrapper) and ring class `activity-ring` (no CSS) — none of the three rail
   selectors `shared.ts:429-432` (`.action-row:has(.activity-indicator.unread)`,
   `:has(.unread-ring)`, `.action-row.unread`) can fire. Callers verified:
   `MachineList.ts:154-155`, `MachineSwitcher.ts:142`, `ProjectList.ts:235-236`,
   `WorkspaceList.ts:204-205` pass `unreadLabel` only from `hasStatusUnread`.
   The core copy (`src/client/src/components/activityBadge.ts:111-115`) uses the
   other contract (returns `undefined` idle+read → wrapper never mounted), so no
   hidden-class trap there — consistent with `activityBadge.test.ts:56`. The
   three-copy drift is structural: `idleMarkHonesty.test.ts:3` imports the
   machines copy directly; the workspaces copy has no direct test (currently
   identical, drift risk only).
3. **Prefetch keying**: `machineId` is read at call time
   (`sessionController.ts:1909`, `selectedMachineId` →
   `state.selectedMachine?.id ?? LOCAL_MACHINE_ID`, `controllers/types.ts:4-6`)
   and used consistently for fetch, `prefetched` key, and merge; the merge-time
   selection race is closed. `prefetched` never evicts on success — fine, since
   opening a session always refetches (dedup only suppresses redundant hover
   prefetch).
4. **Composer alignment**: `footer.collapsed { padding: var(--pi-space-3)
   var(--pi-chat-gutter); }` (`PromptEditor.ts:65`) matches `footer`
   (`:61`) and `.chat` (`chatLayoutStyles.ts:11`); both tokens are
   context-redefined for phones (`index.html:201,203`), so alignment now holds
   at every width; the removed private inset was `var(--pi-space-5)` = 10px
   (`index.html:34`), exactly as the new comment states.
5. **Fold button box**: see Finding 5 — geometry TRUE.
6. **Loop fix**: see Finding 2 — behavior TRUE, message prose FALSE.
7. **Prefetch retry**: `.catch(() => { forget(); })` present and correct;
   success path intentionally keeps the dedup entry.
8. **No test regressions from the wave or the fix**: full suite green
   (603 files / 5205 passed / 5 skipped), including `lazySurfaces.test.ts`,
   `idleMarkHonesty.test.ts`, plugin suites (20 files, 178 tests), and all
   token/layout pinning tests. No test references a removed CSS declaration.
9. **Docs surface**: no living doc outside `docs/design/research/*` round
   snapshots mentions these mechanisms; snapshots are point-in-time by design.
   Changeset package/scope (`@gang-of-beads/pi-web`, patch) matches the diff
   scope; its prose carries the two false claims documented above.

## Suggested minimal follow-ups (for the fixer, not blocking)
- Delete the unreachable `first === undefined` branch + `| undefined` union +
  `?.` in `warmLazySurfaces`, and either implement the banner retirement on the
  success path or amend the changeset line before release notes ship.
- One CSS-text pin per `[hidden]` companion rule (repo precedent exists).
- One unit test for `prefetchSession` merge key + failure forget.
- Drop the still-dead `padding: 0` from `.compact-fold`; fix the "awaited this
  time" / "loaded before it is shown" comments in `lazySurfaces.ts:3-11` and
  `PiWebApp.ts:1747-1749`; remove the double space in `shared.ts:324`.
