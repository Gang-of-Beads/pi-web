# Review triage: B30, a Stop always leaves a visible row

Report (owner, 2026-09-30): "a manual interrupt now shows nothing: no status, no message, it goes straight to idle".

Cause: pi ends a reply the reader stopped with `stopReason: "aborted"`. The browser had a row only for `"error"`. The daemon already recorded the Stop (`pi-web.turn.stopped`, `stoppedBy: "you"`), but nothing rendered it. Commit `af070d94` chose that on purpose ("A reply pi ended with stopReason aborted never had one"); the owner's report overrules it.

Review run `6cc25868`: two lanes on the builtin `reviewer`, Opus (`anthropic/claude-opus-5-5`) and DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`), with ponytail-review and the bob lenses. Brief: `/tmp/b30-review-task.md`. Both returned **OK with notes**. The notes found two more producers of the same symptom, so every producer is fixed here (rule: the same symptom twice stops the patching).

## Findings

| id | lane | finding | verdict | action |
|---|---|---|---|---|
| N1 | Opus | a Stop during a direct handoff aborts the run the handoff starts, but never records the Stop, so it now reads "Interrupted" | true (read `stopHandoffInFlight`) | fixed: the Stop is recorded once the handoff's message has committed, then the run is aborted. `recordStopByReader` records once per turn, so the two paths never write two entries. Test: `inboxReview` F2 now also asserts the mark |
| N2 | Opus | a Stop during pi's retry wait writes no reply (pi only ends the retry), and the failed attempt is hidden as retried, so nothing shows | true: traced in pi (`_prepareRetry`, `_finishCancelledRetry`) and **reproduced live** on the client-only build (the probe's two retry-wait legs failed) | fixed: the Stop entry settles on its own when a user message or the end of the branch comes before any cut reply (`stopOutcomes`, shared). History renders it as the cut-reply shape (`stoppedTurnMessage`), so the one classifier words it. Live, the daemon publishes the same row, with the timestamp it wrote into the entry, when the stopped work ends. The first build settled only on `agent_end`, and the probe still failed: pi schedules the retry after the failed run's `agent_end`, so the wait is ended by `auto_retry_end`. Both now settle it (test "settles a Stop that cancelled pi's retry wait when the retry ends" failed first) |
| N3 | Opus | the `stopReason: "aborted"` clause in `failureKind` had no test (every fixture said "aborted") | true | test added ("Request cancelled", marked and unmarked) |
| N4 | Opus | the probe's screenshot throws when `/tmp/journeys` is missing | true | fixed (mkdir) |
| F1 | DeepSeek | the daemon's `rendersInTranscript` mirror still said only `"error"` replies render. A stopped forwarded command then got "finished without any output" plus a warning notification, a second contradictory row | true (read `sessionCommandService.ts:405` and its test) | fixed: `"aborted"` counts. The settled Stop row also reaches the command watch. Test added |
| F2 | DeepSeek | a cut reply's `message.end` applied twice (a frame replayed across a rebuild) stood the reply and its row twice | true: unit test failed first | fixed: a cut reply settles as one group (`settleCutReply`), replacing an earlier copy by timestamp |
| F3 | DeepSeek | live, the row went behind a message still queued; history puts it right after the reply | true: unit test failed first | fixed by the same group: the row goes directly after the reply, and a row with no reply goes in front of the reader's unanswered messages only |
| F4 | DeepSeek | no test that a retry never takes the stop row back; probe gaps | true in part | test added in `retriedAttempt.test.ts`. The probe now covers two producers (a streaming Stop and a Stop during the retry wait). A Stop during a tool call is not probed live; its wording is unit-tested |
| F5 | DeepSeek | `UNSTATED_REASON` as a `Map` is heavier than a `Record` | judged not true | kept: a `Record` indexed by an arbitrary `stopReason` string also answers prototype keys (`"constructor"` returns a function), and `noUncheckedIndexedAccess` does not catch that |
| F6 | DeepSeek | `probe-stop-cause.mjs` rotted (old wording, a client field that no longer exists); a stale comment said the browser builds the row from `session.stopped` | true | the probe is deleted (`probe-stop-row.mjs` replaces it); the stale comment is removed. `session.stopped` itself stays a published fact; removing it is a protocol change for maintenance |

## Scope notes

- The partial text: pi persisted `content: []` for the stopped fixture reply even though ticks had streamed, so there is nothing to keep. Whether pi keeps a partial reply is the provider's behaviour. B32 (streamed text not shown while streaming) is still to verify on a real provider.
- The first full-suite run had six timeouts in `app.staticAssets`, `app.piWebStatus` and `app.plugins`. All three files pass alone and touch nothing here; recorded under maintenance.
- The first probe run of the full change showed that a reloaded page missed a row the daemon had appended without a live frame, while a fresh page showed it. That is B7 (tail loss is detected from the head, not from delta replay), recorded there.
- The daemon changed (`piSessionService.ts`, `sessionCommandService.ts`, shared `branchMessages.ts`), so production needs a manual session daemon restart when this ships.

## Live verification (8505, 393x850, coarse pointer)

`scripts/probe-stop-row.mjs`:
- Build before B30 (`c2411e77`): 2 of 6 legs failed (no row live, none after a reload).
- Build with the client half only: the streaming-Stop legs pass, and the two retry-wait legs fail (N2 reproduced).
- Full change: see the commit.
