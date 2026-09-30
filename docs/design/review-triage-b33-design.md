# Review triage: B33 with B6 design (one inbox record; pi's queue as the injection point)

Design: D1 in `state-diagram.md`, "The queue is for waiting, not for pacing". Review run `1358db22`, design only (no code): Opus (`anthropic/claude-opus-5-5`) and DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`). Both returned **sound, with changes**.

Both lanes verified the core against the SDK:
- at idle, `steer(B); steer(C); prompt(A)` reaches the model as one request, `[A, B, C]`;
- nothing in `prompt()`'s preflight clears or reorders the lane;
- the settle safety net covers a steer that lands after the run's last check.

Neither found a simpler shape that meets the owner's rule. Holding until a tool-less `turn_end` and batching after the settle was rejected: it adds a settle round trip that runs `agent_settled` extension hooks ahead of the reader's batch. Handing at acceptance without a durable record was also rejected: it breaks "queued messages survive a restart".

| id | lane | finding | verdict | design change |
|---|---|---|---|---|
| F1, R1, R2, R3, R11 | both | Every inbox reader assumes "in the inbox" means "not in pi". A handed record in the same list would be steered twice, recalled wrongly, or discarded twice | true (P0/P1) | Two lists: `waiting` keeps its readers unchanged; a separate persisted `handed` list is touched only by settle, take-back and restart |
| F2, R10 | both | Settling on the client-id expectation misses a message an input handler or template rewrote, so its `handed` record sticks and resurfaces | true (P1) | Settle by position, with the facts `directCommitWatchers` and the consumed-steer settle already use |
| F3, R5 | both | Restart: a message pi committed just before the daemon died would be handed again | true (P1) | On open, drop a handed record whose id is on a branch user entry (the id is stamped at `message_start`, before the append); id-less messages get a daemon id at acceptance |
| F4, R3 | both | Recall of a lane-held message went through clear-and-replay, which re-runs input handlers and can split the batch | true (P1) | Splice by FIFO position from pi's lane arrays, synchronously |
| F5, R9 | both | The status list would double-count a message in both the inbox and pi's lane | true (P1/P2) | The list is the inbox (`waiting`, then `handed`, by `seq`); pi's lane is never read for it |
| R4, F6 | both | Idle-batch steers give no landing signal, and `steer` rejects extension commands | true | Landing from lane growth; the batch ends at the first extension command |
| R6, F8 | both | If the oldest is refused, the steers already queued behind it overtake it | true (P1) | Take the batch's steers back before restoring the oldest, in `seq` order |
| R7 | DeepSeek | The idle batch must re-arm `steeringMode = "all"` (a `/reload` resets it) | true (latent) | Named in the design |
| F7 | Opus | An extension starting its own run between the steers and the oldest's prompt makes them overtake it | true | Documented as a known limit; the batch runs under `handing` so Stop waits |
| F9 | Opus | Waiting through an in-run auto-compaction misses pi's re-poll after it | true | Hand during an in-run auto-compaction |
| R8 | DeepSeek | One `handed` phase loses the loop-held distinction (G4) | true | Only a lane-held message returns to `waiting`; loop-held stays handed |
| F10, R12 | both | "Before the daemon hears of the run" was inaccurate; the diagram's `handed → unverifiable` became unreachable | true | Reworded; the arrow is now `handed → queued` on restart |
| R13 | DeepSeek | The tests the rule flips were unnamed | true | Named in "Order of work" |
| R14 | DeepSeek | The idle batch is independent of the durable phase, and the failing test does not prove it | true | Two commits: the idle batch with its own test, then hand-at-acceptance with the durable list |
