# Review triage: a message keeps its send time (B5, `04d9249c`)

Two lanes on the frozen tree `/tmp/pw-b5` (workflow `38ec77cc`): Opus 5.5 (`b5-opus`) and DeepSeek 4.1 max (`b5-deepseek`). Both returned OK with notes, with no P0 or P1. Each claim was checked against the source before triage.

## Verified by both lanes

- The in-place stamp reaches pi's persisted transcript. agent-core emits `message_start` and `message_end` with the same user-message object, and `agent-session.js` persists `event.message` after the synchronous listeners ran.
- An earlier user `timestamp` breaks nothing in pi. Compaction and cache stats read assistant timestamps only, `getMessageActivityTime` takes a maximum, and `turnStartedAtFromBranch` reads the entry timestamp first.
- Nothing orders or groups rows by `meta.timestamp`. A slow sender clock changes only the label.
- `sentAt` reaches a remote daemon: the web proxy and the machine proxy forward the request body unchanged.
- Old peers do not regress. An old browser on this daemon gets `acceptedAt` on every device. This browser on an old daemon sends a field the old route ignores.

## Findings

| # | Finding | Lanes | Verdict | Disposition |
|---|---|---|---|---|
| 1 | An inline comment was added at the acceptance echo. | Opus (P2) | TRUE | Fixed: the reason moved into the `stampCommittedUserMessage` docstring. |
| 2 | The new test helper's docstring was stacked under the existing helper's. | both (P2) | TRUE | Fixed: each helper carries its own. |
| 3 | A sender whose clock runs ahead of the daemon's sees its own row move back once, to the daemon's acceptance time. | both (P2) | TRUE, by design. | Kept: the clamp stops a message from being dated after the reply to it. Every other device shows the clamped time from the start. Recorded in state-diagram D1. |
| 4 | The take-back fallback entry has no `sentAt`. | both (P2) | TRUE as a shape gap; not observable. The fallback serves pi lane entries the daemon never recorded, which have no published id and therefore no stamp. | Hardened: the fallback entry's send time is its acceptance time. |
| 5 | `parseEntries` accepted any string as `sentAt`, so an edited or corrupt inbox file with `""` would show no time. | DeepSeek (P2) | TRUE | Fixed: a send time that does not parse falls back to the entry's acceptance time. A test was added and it kills the reverting mutant. |
| 6 | The page-B legs of `probe-message-rows.mjs` pass vacuously when page B draws nothing. | DeepSeek (P2) | TRUE | Fixed: page B gets its own precondition. |
| 7 | An outbox retry shows the time the message was first sent, even hours later. | Opus (product note) | TRUE as described. | Kept and recorded in D1. The row has shown that time all along, and re-dating it on Retry would be the move B5 forbids. Raised with the owner. |
| 8 | An extension that replaces a user message at `message_end` (`_replaceMessageInPlace`) drops both the id stamp and the time stamp. | Opus (residual) | TRUE, pre-existing for the id stamp. | Not fixed here: no bundled extension replaces user messages. |
| 9 | A device that joins mid-queue shows a queued row with no time until the echo or the commit lands. | both (note) | TRUE | Not a move: no time, then the right one. |

## Evidence

- `probe-message-rows.mjs` on 8505: 11/12 before the change (page A's time moved by 13–20 ms when the turn took the message), 12/12 after, both pages showing the sender's time.
- 12/12 mutants killed on the change; the parse guard's reverting mutant is killed by its new test.
