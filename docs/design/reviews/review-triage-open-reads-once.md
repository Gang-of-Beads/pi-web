# Review triage: P3 slice c, an open reads the session once

Review run `15bbbf6c`, two lanes on the builtin `reviewer`:

- Opus 5.5: `review/p3c-opus.md`
- DeepSeek 4.1 max: `review/p3c-deepseek.md`

Both lanes gave "OK with notes" and found no P0 or P1. Each finding is marked fixed, not fixed with the reason, or judged not true. The design is in state-diagram D5, "An open reads the session once".

## Measured

On 8505, at 393×850, `probe-open-reads.mjs` opens a small seed session. Its cold open (runtime stopped first) raises startup dialogs.

| Open | Before (`7162cc3c`) | After |
|---|---|---|
| Cold | 5 status reads, 5 stream syncs, 1 tail | 1 status read, 0 stream syncs, 1 tail |
| Warm | 1 status read, 1 tail | 1 status read, 1 tail |

The startup dialogs still show in both cases.

## Findings

| # | Lane | Finding | Verdict | What changed |
|---|---|---|---|---|
| Opus-1 / DS-2 | both, P2 | A refresh could end without settling the dialog surface. When the transcript read failed, the status read beside it was discarded, so its dialogs never showed and `reading` stayed true. A stale status read, and the delta replay's stale branch, did the same. | **True, fixed** | `settleStatusRead` reports a failure and settles the surface. `settleDialogSurface` settles it without reporting: a fresh read applies, and anything else is `readFailed`. When the tail fails, the status read still settles the surface, so its dialogs show, but it never reports, because the tail's error is the one report. The first version of this fix reported a code there too. The probe test caught a relocated selection of the same session joining the still-running failing refresh through the trailing coordinator, because they share its key. Tests: the tail fails while the status answers (dialogs show, and the next dialog applies with no read); the status read loses to a newer status frame (the next dialog asks again). |
| Opus-2 | Opus P2 | `repairAgain` cannot run in production. The controller's resync returns `void`, so `resyncRunning` lasts a microtask, and a repair's read always settles after it. | **True, fixed** | `repairAgain` and its test are removed. |
| DS-1 | DeepSeek P2 | A repair read that fails while a repair runs drops the waiting frame. | **Judged not reachable** | It needs `resyncRunning` to be true when the repair's read fails. That is the same microtask window as Opus-2, which the controller's `void` resync never reaches. With `repairAgain` removed, `readFailed` calls `scheduleResync`, and nothing is running then. |
| Opus-3 / DS-3 | both, P2 | Comments the change invalidated: the socket's "validators drop the seq" note, an inline comment that repeated the new map's docstring, two stacked comment blocks above `isStreamEventBelowWatermark`, and the `alreadyApplied` docstring. | **True, fixed** | The stale inline comments are deleted. The watermark comment is one docstring that names the revisioned exemption. `alreadyApplied` is described as it now works. |
| Opus-4 | Opus P2 | The `markUnfresh` contract drifted: frames would `await` instead of resyncing. It has no production caller. | **True, fixed** | `markUnfresh` and its test are removed. |
| Opus-5 / DS-4 | both, P2 | On a daemon without epochs, a revisioned frame applied below the snapshot made a reflected transcript frame look like a new seq space. It was applied twice and resynced. | **True, fixed** | `startsNewSpace` compares against the highest seq this space applied, not against the frontier, which includes the snapshot. Test: a revisioned frame at 57 below a seed at 60, then a reflected transcript frame at 59, gives no reapplication and no resync. |
| DS-5 | DeepSeek | `probe-open-session-gone.mjs` was modified but was not in the diff. | **True, by design** | It is its own commit: the G3 precondition fix found on this build, where a copy was sometimes the workspace's latest session and was left open on the daemon. |
| Opus hunt 1 | Opus | With an older daemon that sends no `pendingDialogsRevision`, revisioned frames now `await` forever instead of resyncing on each frame. | **True, recorded** | Before this change those frames were never applied either, because the resync's status also carried no revision, so the surface never became fresh. `pendingDialogs` still arrives through status frames. Whether such a daemon is still deployed is unverified. |

## Mutation checks

Each new branch is killed by at least one test:

- the `await` verdict;
- settling an awaited frame;
- `readFailed` turning `reading` off;
- a resync turning `reading` back on;
- the controller's `readFailed` calls on both the failed path and the stale path;
- the tail-failure status settle, and its never-report rule;
- seqs kept on dedicated frames;
- the gap repair's revisioned exemption;
- the watermark exemption;
- the epoch-less space check.
