# Review triage: live surfaces P1 slice 3 (the machines roster and remote deep links never give up)

Run 6088e664, two lanes on the reviewer shell:
- Opus 5.5, focused on selection, hangs and the app row;
- DeepSeek 4.1 max, a full pass.

Both used the ponytail and bob lenses. Brief: `/tmp/p1s3-review-task.md`. Both returned **OK with notes**, with no P0 or P1.

Their P2s all describe the same window: a roster answer that lands long after it was asked for. That can be a retry after a lost read, or an answer that waited on a remote machine's health read. Each claim was checked against the source before it was fixed.

## Fixed

| id | lane | finding | fix and proof |
|---|---|---|---|
| O-P1 | Opus | The reader leaves a remote deep link during the boot wait (Back, or a tap), and the late roster answer still selects that machine with nothing loaded: the URL says local while the state says remote | The preference carries `wanted`. The boot passes "the intent is current and the URL still names that machine", and a preference no longer wanted keeps the machine the reader is on. Test "keeps the current selection once the deep link…" (mutation-checked) |
| DS-1 | DeepSeek | An apply that waited on a remote health read wrote the choice made before the wait, reverting a machine selected meanwhile and pinning the reverted choice | The choice is decided again after the await, from the answer already read (no second health read), and `previous` is read at write time. Test "keeps a machine the reader chose while the answer waited on a health read" (mutation-checked) |
| DS-2 | DeepSeek | Adding or removing a machine never reached the roster, so an answer read before the change undid it (a removed machine came back for the rest of the page) | `rosterChanged` updates the known roster and reads it again, so a stale answer in flight is followed by a fresh one, as in `ProjectController`. Test "ends with a removed machine gone…" (mutation-checked); "lists and selects a machine the reader added" guards the add path |
| O-P2 | Opus | The ladder that never gives up raised its notice again on every try, bringing a dismissed banner back every 15 s or less | The ladder remembers the words it raised and raises again only when they change (a new health detail). Test "does not raise the same notice again after the reader dismissed it" (mutation-checked) |
| O-P3 / DS-4 | both | The banner's Retry re-read the roster with no machine, which moved a reader on a remote machine to the local one; now possibly seconds later | Retry asks for the machine the reader is on. `selectMachine` records the preference before its early return. Test "re-reads the roster for the machine the reader is on" (mutation-checked) |
| O-P5 | Opus | A refused roster leaves `machinesLoad` at "loading" | The type's docstring now says so. The refusal is shown as a notice, and nothing reads the roster again until asked (the fact rule, object model §0) |
| O-P6 / DS-5 | both | Stale docs: object-model §1.1 still said "Today it is …failed"; §2.1 listed `MachinesLoadState` as deleted; the `appState` field comment said "Four-state" | Rewritten |
| DS-6 | DeepSeek | Two blank lines left where the old delay helper was | Removed |
| O-P7 / DS-7 | both | The explicit delay duplicated the default parameter; `MachineControllerDependencies.clock` had no caller; the 15 s cap was declared four times | The default is gone and every caller passes the delay. The unused clock dependency is removed. One `QUIET_WINDOW_MS` in `sync/readPhase.ts` serves the projects, workspaces and machines controllers and the ladder |
| DS-8 | DeepSeek | Tests leaked fake timers on failure; the probe's leg B stopped checking the URL once healed and never counted row mounts | `vi.useRealTimers()` moved to `afterEach`. Leg B checks the URL for the whole run and asserts at most one row mount |

## Not changed

| id | lane | finding | why |
|---|---|---|---|
| DS-3 | DeepSeek | A roster the web process refuses (401 or 403) ends the boot of a remote deep link: the notice shows, and nothing restores | By design: a stated refusal is a fact, shown as itself, and it ends retrying for that key (object model §0). Proceeding would flatten the link to the local machine, which the boot exists to prevent. The in-repo roster route never answers 401 or 403 (`pi-web-plugins/machines/server-plugin.ts`), so this needs a fronting proxy. Recorded for the typed row causes slice, where a signed-out fact opens sign-in |
| O-P4 | Opus | The boot reads the roster twice in a row after a lost read (`whenAnswered` refreshes at once) | True and harmless. The backoff is not reset, and the extra early read is what heals a short loss sooner |
| DS-8 (tests) | DeepSeek | "restores the deep link once the roster answers" and "does not wait on a local route" pass on HEAD | True. They guard the restore and the local path; the waiting behaviour is pinned by the tests that fail on HEAD |
| hunt 1.2 | DeepSeek | The roster never calls `recheckWaiters`, so a boot wait can outlast the reader leaving by up to one retry | True and harmless: the preference's `wanted` makes the late answer keep the current selection, and `rosterAnswered` checks `wanted` again before the boot acts |

## Verification

- **Tests:** the fail-first tests fail on HEAD; the five guards above were mutation-checked.
- **Probe** `scripts/probe-roster-heals.mjs`, phone 393x850, with 5 s of roster loss:
  - old build: 7/9; the local route never healed, and the remote deep link took 12.2 s;
  - new build: recorded in the commit.
