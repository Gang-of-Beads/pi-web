# Review triage: P3 slice a (a session open is not stuck behind the board)

Review run b916e4fd had two lanes on the reviewer shell, using the ponytail and bob lenses. Brief: `/tmp/p3-review-task.md`. Three changes were reviewed, and they land as three commits.

| change | Opus 5.5 verdict | DeepSeek 4.1 max verdict |
|---|---|---|
| A. The board through two lanes, with the transcript read first (client) | OK with notes | OK with notes |
| B. One scan pass per directory (daemon) | OK with notes, one P2 | OK with notes, one P2 |
| C. The plugin asset check asks only the view that decides (web) | OK | OK with notes |

I checked every claim against the source before fixing it.

## Findings

| id | lane | finding | verdict | action |
|---|---|---|---|---|
| B-P2 | both | Point lookups went through the shared pass too: `findSession`, behind `locate`, and `messagesPassive`, through `list`. A lookup joining a pass whose directory read predates a file written before the lookup asked answers "not there". For `locate` that becomes the fact `gone`, which is final, so a live session would be declared gone | true | The scanner has `scanSessionSummariesInDirNow`, a pass that starts at the call and is never shared. `findSession` uses it for every directory, and `messagesPassive` now looks its session up through `findSession` instead of `list`. Listings keep the shared pass; a listing's staleness is bounded and the next listing repairs it. Tests: the scanner's start-now pass reads the directory again beside a running pass; the gateway's lookup does the same beside a running listing. Mutation-checked |
| A-P3a | both | The reject path of `mapWithLanes` was tested only where the caller swallowed it, and no board test had a refusal from a listing | true | Tests: a failing read rejects the whole; a 403 from a sessions listing rejects the board through the lanes |
| A-P3b | both | After a read fails, the other lane keeps starting reads whose answers are thrown away | true, not a regression | A failure stops every lane from taking another job; tested with two lanes (it failed before the fix) |
| A-P3c | DeepSeek | `lanes = 0` answered `[]` | true, unreachable | Clamped to at least 1; tested |
| A-P3d | Opus | The time for the whole board to finish was not measured; the cap could make it slower | true, not measured at review time | Measured from the request timelines on 8505. The last board listing ended at 1258 ms before, 1331 ms with lanes, 1202 ms with lanes and the shared pass, and 1060 ms final. The board does not finish later |
| A hunt | both | Is 2 the right number? | plausible, not proven | Kept; the measured result meets the budget. A different count was not measured |
| C-P3 | DeepSeek | The docstring said serving a module "never waits on the daemon", but the first, uncached serve still reconciles the lifecycle, which asks both views | true | The docstring says what it covers |
| C naming | Opus | The docstring and test said "P2 slice c" | true | Relabelled P3 slice a |
| B-adjacent | DeepSeek | `invalidate()` can be lost to a racing scan's `memo.set` | true, and it predates this change; sharing narrows it | Not changed |

## Verification

- **Tests:** suite 4859 (client, server and shared) plus the new gateway test; tsc and eslint clean.
- **Mutants killed:** the lane cap, the stop after a failure, the zero-lane clamp, the shared pass, the start-now lookup (scanner and gateway), transcript-first, the decider view.
- **8505, phone, daemon-cold, `probe-open-latency.mjs`:**

  | build | first row |
  |---|---|
  | before P2c | 2.68 / 3.12 / 4.42 s |
  | P2c | 2.06–2.33 s |
  | + lanes | 1.34 / 1.48 / 1.63 s |
  | + shared pass | 1.16 / 1.33 / 1.55 s |
  | + transcript first and asset check | 1.34 / 1.11 / 1.14 s |

  Every row was drawn before its status. After the review fixes (rebuilt, daemon restarted): **1.18 / 1.13 / 1.21 s**.
- **Regression probes after the fixes:** `probe-session-gone` 17/17, `board-heals` 9/9, `workspaces-heal` 13/13, `read-heals` 8/8, `row-cause` 6/6, `roster-heals` 10/10. Suite 5980 passed; knip and tsc clean.
