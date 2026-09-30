# Review triage: live surfaces P1 slice 2 (workspaces never give up)

Run eb774586, two lanes on the reviewer shell:
- Opus 5.5, focused on hangs, scope and waiters;
- DeepSeek 4.1 max, a full pass.

Both used the ponytail and bob lenses. Brief: `/tmp/p1s2-review-task.md`. Both returned **OK with notes**, each with one P1 and no P0. Where the lanes overlapped, they agreed; each finding below was checked against the source before it was fixed.

## Fixed

| id | lane | finding | fix and proof |
|---|---|---|---|
| P1-1 | both | Locating a session walked the projects in order, and each read now waits for an answer, so one project that never answers (a 404 or 500 counts as no answer) hid the owner behind it | Every project is asked at once and the first owner wins; the other waits are released once the session is placed. Test: `sessionAncestorLookup.test.ts` "asks every project at once…" (fails on the serial walk) |
| P2-1 | Opus | `whenAnswered` read once more for a reader who had already left | It returns before reading when `wanted()` is false. Test "does not read at all…" |
| P2-2 | Opus | A pending pick overrode a workspace the reader chose in the same project meanwhile (a session from the quick switcher) | `stillChosen` also requires that no workspace was chosen since. Test "yields a pending pick…" (mutation-checked) |
| P2-3 | both | An abandoned `selectProject` held the route restore open, and its terminal id was applied under the project the reader tapped | `follow()` re-checks every waiter when the followed project moves, so the abandoned pick ends at once. `selectProject` resolves whether it landed, and `restoreRouteFor` stops when it did not. Test "gives up a pending pick at once…" (mutation-checked) |
| P2-4 | both, and found by me | A machine switch and a session from another project write the selection directly, so the project left behind was watched and retried forever | The followed key is derived from the selection: `PiWebApp.setState` calls `selectionChanged()` whenever machine, project or workspace moves. Tests "stops reading a project left behind by a machine switch" and the PiWebApp wiring test (mutation-checked) |
| DS P2-2 | DeepSeek | A stated refusal discarded a list the machine had already given, leaving the project blank | The mirror, now the one writer of a listing into the state, keeps known rows through a refusal; `selectProject` still picks from them. Test "keeps a list the machine already gave…" |
| P3-1 | Opus | A lost read after a refusal still reported the old refusal | A no-answer clears the fact. Test "treats a lost read after a refusal as no answer" |
| P3-2 / P3-6 | both | Applying an answer never ended loading, which is why `picking` was needed | `applyProjectWorkspaces` ends loading; `picking` is removed (ponytail) |
| P3-3 | Opus | `refreshProjectWorkspaces` handed the deletion flow a stale list after a lost read | It requires a fresh answer (live, no fact). Test "will not hand a deletion flow a stale list…" |
| P3-4 | Opus | A `refresh` after `dispose`, or one queued behind a read in flight, never settled | Both settle. Test "settles a refresh asked for after dispose…" |
| DS P3-5 | DeepSeek | A refusal on a background refresh of the shown project showed nowhere | The mirror notices a fact, like the projects controller. Test "shows a refusal that lands on a background refresh…" |
| DS P3-7 | DeepSeek | Opening a workspace from the quick switcher ran `selectWorkspace` twice (preferred, then explicit), and the deferral widened it | It passes the workspace as the pick's target, so there is one pick |

## Not changed

| id | lane | finding | why |
|---|---|---|---|
| P3-5 | Opus | `TrailingRefreshCoordinator` is mostly redundant with the resource's dirty re-read | True. It still adds the 50 ms burst debounce that an existing test pins; removing it is a separate change |
| DS P3-8 | DeepSeek | "stops reading a project the reader left" passes on HEAD | True. It guards the new retry (HEAD never retries at all), so it cannot fail there. It is kept as a regression guard, and the fail-first tests above cover the behaviour |
| DS P3-9 | DeepSeek | The changeset and probe are untracked | Staged by path in the commit |
| hunt 5.1 | both | `retryWorkspacesLoad` now means "read now", with nothing painted on failure | Intended and documented in `plugin-api.ts` |

## Verification

- **Tests:** the new tests fail on HEAD. The two guards were mutation-checked (the same-project choice and the recheck).
- **Probe** `scripts/probe-workspaces-heal.mjs`, phone 393x850:
  - old build: 9/13 (B and C never heal, and show "No workspaces found");
  - new build: recorded in the commit.
