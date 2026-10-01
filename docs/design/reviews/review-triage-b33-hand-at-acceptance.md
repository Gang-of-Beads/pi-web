# Review triage: B33 commit 2, messages handed to a running agent at once

- **Commit:** `8550ee13`, "Hand messages to a running agent at once, and keep them durable until read".
- **Lanes:** two reviewers read a frozen worktree (`/tmp/pw-b33c2`) with the bob and ponytail lenses. Workflow `fe25c1de`.
  - Opus 5.5: OK with notes.
  - DeepSeek 4.1 max: BLOCK on one P1.
- **Follow-up:** the "Follow-up commit" section below.

Each finding was settled by reading the source. Where a finding needed a failing test, that test is named, and it fails on `8550ee13`.

## Fixed

| Lane | Finding | Verdict | Fix |
|---|---|---|---|
| DeepSeek P1 | Status hides a handed message whose text repeats an earlier user message: no row, no position, no recall, no Clear. `queuedMessagesFromSession` filtered pi's lanes by text against the whole transcript. | **True.** Before B33 a message waited in the inbox, which was not filtered, until a gap. Now it waits in the lane for the rest of the run. "continue" and "yes" are common repeats. A second effect: the id correlation ran on the text-filtered list, so a hidden entry shifted every later id. | Lanes are correlated with their held-steer records first, as `partitionLanes` and `settleConsumedSteers` already do. An entry with a record is listed. Only an entry no record accounts for (one an extension pushed) is checked against the transcript text. Ids are published in the same pass, and `attachQueuedPromptClientIds` is deleted. The text pass now runs only when an uncorrelated entry exists, so an empty lane costs nothing. |
| DeepSeek P1 (second symptom) | An id-less sender's repeated message is not answered as a duplicate while the first copy waits in the lane (`hasQueuedMessageText` goes through the same filter). | **True.** | Same fix. Test: "I6: a sender without ids that repeats an earlier message…". |
| DeepSeek P2 | I6 passes for the wrong reason: the default fixture lane is empty, and status is read before the handoff. | **True.** | I6 now models pi's lane (`laneOf`: push, `queue_update`, preflight) and waits for the steer to land before reading status. It fails on `8550ee13`. |
| Opus P2-1 | A daemon crash while an extension command's handler runs makes the command run again after restart: it writes no user entry, so `returnHanded` returns it. | **True.** Before this commit `take` removed the entry from the file, so it was lost instead. | An extension command leaves the handed list before `session.prompt`, making commands at-most-once again. Test: "runs an extension command at most once…". A dying daemon loses the command, as before the handed list existed. Input-handler consumption cannot be predicted, so that window stays and is recorded under residual risks. |
| Opus P3-1 | A message withdrawn, refused or read just before a crash can run again: the ledger append is synchronous, but the handed-list write is not. | **True** (a window of milliseconds). | At restart, a handed entry whose ledger row can no longer move (`!SETTLEABLE`) ended before the crash. It is dropped and keeps its outcome. Only entries found on the transcript are settled `succeeded`. Test: "drops a message withdrawn or refused just before the daemon died…". It covers `failed` because that row is re-admittable, so a re-record would have rewritten it. |
| Opus P3-2, DeepSeek P3 | `HandoffFacts.trigger` is dead input: no branch of `BY_RUN_STATE` reads it. | **True.** | Deleted `HandoffTrigger` and `trigger`. The event map is now `HANDOFF_WAKE_EVENTS`, a set of the events that may change the decision. The decision table test lost its trigger column. |
| Opus P3-3 | An orphaned docstring sits on `WAITING_MESSAGES_BLOCK_ARCHIVE`. | **True.** | Moved onto `publishedId`. A second orphan, a stale docstring stacked above `attachQueuedPromptClientIds`, went with that method. |
| Opus P3-5 | The changeset overclaims "never twice". | **True** for an id-less message read just before a crash, and for an input handler's consumption. | The changeset is reworded: a message runs once; one sent without an id can run again only if the daemon died the moment it was read. |

## Not fixed, with reason

| Lane | Finding | Verdict | Reason |
|---|---|---|---|
| Opus P3-4 | `takeRuntimeLanes` settles a client-id entry that `withdraw` settles again. | True, harmless. | `settleHanded` of a key no longer handed is a no-op on the same serialized chain. The first call is needed for local hold keys, which `withdraw` never sees. Returning raw keys to collapse the two would widen a public-ish return type for no behavior change. |
| DeepSeek P3 | An id-less message read just before a crash is delivered twice. | True. Documented in `ownedPromptQueue.ts` and in the changeset. | Recognising it would mean stamping a local hold id on the transcript, which other readers of the transcript would then see. Before B33 such a message was lost instead. Accepted for now. |
| DeepSeek P3 | A rollback to an older daemon drops the `handed` list on its next write. | True. | Rollback is not supported across a daemon release. The file still reads, and only the handed messages are forgotten, which matches what the old daemon did with them. Recorded. |
| DeepSeek P3 | A runtime replaced under a different session id (fork, clone, tree navigation) strands the old id's handed entries until a restart. | Judged **not reachable**. | Fork, clone, `/reload` and tree navigation all require idle (`sessionCommandService.ts`, confirmed by the Opus lane), and at idle the handoff has already taken pi's lane back (`takeBackHeldMessages`). Nothing is handed at that point. |
| DeepSeek note | A command handed mid-run is listed nowhere while its handler runs. | True; this shape existed before. | A command has no lane position and no record, and the handler is the run. Listing it as queued would be wrong. The row says what the ledger says. |

## Hunt items both lanes judged false
- `returnHanded` doubling a live runtime's entries.
- A late settle after `restoreFront`.
- Reordering between the fire-and-forget settle and a later take.
- Positional correlation settling a still-held record.
- `takeBackHeldMessages` minting new keys for daemon-handed entries.
- File compatibility (old file, a file with only `handed`, quarantine, the startup drain).
- `steeringMode` after `/reload`.

## Follow-up commit
- **Tests:**
  - New: the two I6 tests, the withdrawn-or-refused crash test, and the command-at-most-once crash test. All four fail on `8550ee13`.
  - Reshaped: the `promptHandoff` decision table.
- **Mutants:** seven of eight killed.
  - MA: lanes decided by text again.
  - MB: no ledger check at restart.
  - MC: command not settled before it is handed.
  - MD: every ended entry settled as read.
  - ME: a local hold id published.
  - MG: an unknown row counted as ended.
  - MH: no text guard for uncorrelated entries.
  - **MF survives** (the dedupe by id dropped). It is equivalent: the guard dates from `61572647`, beside the queue's per-id push guard. One id cannot sit in the inbox and in pi's lane at once, because `take` and take-back move an entry atomically (the take-back clears the lane before `restoreFront`). It stays as the cross-source guard it was written as.
  - MG first survived because the crash-held test used the id `c-held`, which the ledger rejects as malformed (ids need 8 or more characters). The test never exercised the restart through the ledger. It now uses a well-formed id.
- **Live check** (`scripts/probe-batch-running.mjs`, new leg): during a long reply the probe sends B, C and D, then repeats the session's first message, "warm up", with an id.
  - **Old build, 3/4.** The repeat is not listed, and every id shifted by one: B carried C's id, C carried D's, D carried the repeat's. The position correlation ran on the text-filtered list and dropped the oldest record as delivered. A recall from B's row would have taken back C. That is worse than the hidden row the lane predicted.
  - **New build:** see the gate.
- **A gate failure, traced to the probe:** `probe-inbox-order` failed once, in a gate that ran it right after `probe-queue-restart` on the same seed session. Its busy prompt arrived 6.6 s after the daemon resumed the restored message, while the session was still answering it. So the busy prompt was queued as a steer, and the new status listed it, correctly, with its own id. The old text filter would have listed it too; that gate order was new.
  - Reproduced on 8505 with a session kept busy. The steered prompt is listed only while it waits, and the three after it each keep their own id.
  - The probe checked its precondition by `isStreaming` alone, which the restored run satisfied. It now waits for an idle session with nothing queued before each busy run, and fails loudly if it never gets one.
- **Restart:** the session daemon needs a restart.
