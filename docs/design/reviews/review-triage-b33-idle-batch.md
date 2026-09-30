# Review triage: B33 commit 1, the idle batch

Change: at the idle injection point, every waiting message up to the first extension command reaches the model in one request (D1, `state-diagram.md`). Review run `b1e7ed02`: Opus (`anthropic/claude-opus-5-5`) and DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`), both **OK with notes**, no P0.

Live on 8505 (`scripts/probe-batch-handoff.mjs`, three messages waiting through a stack restart):
- the build before this change passed 3 of 5 legs, with requests `[[B],[C],[D]]` and three answers;
- this change passes 5 of 5, with `[[B,C,D]]` and one answer.

| id | lane | finding | verdict | action |
|---|---|---|---|---|
| O-P1 | Opus | A close that cannot wait for the oldest's preflight (5 s bound) empties pi's lanes. The late take-back then reads the queued messages as read, so they are lost and marked succeeded | true, reproduced (the new test fails without the fix: inbox `[]`) | Fixed: when the bound times out, `keepWhatThePiHolds` takes back what pi holds at once. Test "keeps the queued ones in the inbox file when the session closes…" |
| O-P2a | Opus | `steerAhead` holds a steer without the ownership checks of `handToRuntime` | true (narrow) | Fixed: returns false when the runtime is no longer served; holds only when it owns the id |
| O-P2b | Opus | The diagram's restart edge `handed --> queued` describes commit 2 | true | Fixed: the edge says "B33 commit 2, until then unverifiable" |
| O-P2c | Opus | Recalling a queued message waits for the oldest's preflight | true, inherent to commit 1 | Recorded as a known limit in D1. Commit 2's synchronous splice-recall removes it |
| O-P3 | Opus | The steer-batch registration is duplicated | true | Fixed: one `asSteerBatch` wrapper |
| D-P1 | DeepSeek | The changeset is untracked and missing from the reviewed diff | true | Staged in this commit |
| D-P2a | DeepSeek | A throw inside the steer phase (ledger or inbox write) loses the head | true (disk failure) | Fixed: take back, restore the head, rethrow. No test: the service has no failing-fs seam |
| D-P2b | DeepSeek | A runtime replaced after the close bound can settle lane-held records of the old runtime as succeeded | true, pre-existing shape | Not fixed here. Note for commit 2: the `handed` list's "back to waiting" applies on every open, not only after a restart |
| D-P3a | DeepSeek | `emptyQueues` waits on the steer batch without a bound | true, pre-existing, exposure grows | Recorded as a known limit in D1. Bounding it would let a steer land after Clear told every device it was withdrawn |
| D-P3b | DeepSeek | The transient path does not publish status | true (invisible for up to one heartbeat) | Fixed: status is published on every path |
| D-P3c | DeepSeek | Input handlers see the batch's messages as idle input, not "as for any steer" | true | Fixed in the D1 wording |
| D-P3d | DeepSeek | Mechanism items 2, 5 and 6 are commit 2's | true | The D1 "Order of work" names them; the diagram edge is marked |
| D-test | DeepSeek | No batch test carries images; the probe swallowed a timeout | first: judged low (the restore path reuses the stored entry, images included); second: true | The probe's drain is now its own failing leg |
| — | both | Head refused when the close rejects its preflight | pre-existing (`handDirect` identical) | Unchanged: the row shows it failed with Retry, never silently. Classifying "runtime gone" as transient risks a second run when pi committed after the listener was detached |

## Bob pipeline (run b0df5a53) and the Playwright MCP run

Bob's scouts reported four findings. Its skeptics refuted one and kept three. The fix stage did not run: the `worker` agent's model is not in the registry. The supervisor applied the three fixes in the follow-up commit.

| id | finding | skeptic | action |
|---|---|---|---|
| bob-1 | The Clear test omits the head's outcome and never exercises Stop | refuted: the head never enters the steer batch; Stop's wait on the shared `steerBatches` is covered by the o4 and f3 tests | none |
| bob-2 | The refused-oldest test never asserts that the three are waiting again | real | Asserts all three `pending` after the refusal |
| bob-3 | The refused-steer test cannot tell a message held in the lane from one back in the inbox | real | Asserts an empty lane, the inbox file `[B, C]`, and both `pending` |
| bob-4 | `promptHandoff.ts`'s module header still says "the oldest waiting message starts the next run" | real | Header reworded |

Playwright MCP on 8505, rebuilt at `c20610ad`, 393x850:
1. Through the composer: a long reply, then B, C and D sent with "Steer current response (queued if busy)". The page showed them as `Queued · 1/2/3`.
2. The stack was restarted while they waited.
3. The fixture recorded one request carrying the cut prompt with B, C and D. After a reload, the page shows B, C and D once each, in order, with one answer ("one answer for 4 messages").

Found on the way: the restarted daemon listened 31 s after its plugins activated, with nothing logged in between. That went to the object-model triage as a startup-path finding.
