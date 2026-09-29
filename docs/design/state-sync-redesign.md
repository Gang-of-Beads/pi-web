# State synchronisation redesign: one FIFO, facts not copies

Owner, 2026-09-28: messages consumed out of order, one parked forever, "No answer yet" with no
exit, "idle" while the agent ran, a panel stuck on "Reading…". He asked for proof, not guesses,
and for every state that crosses the network to be handled in a functional style: impure steps
at the edge, decisions as pure functions of facts.

## Evidence

Four review lanes (ordering and realtime on Opus 5.5, confirm and reads on DeepSeek 4.1) wrote
**47 repro tests that fail on the current code**, each re-run by the parent. They are backed by
live repros on 8505 and records from the owner's session on 8504.

| Lane | Failing repros | Files |
|---|---|---|
| ordering | 18 | `src/server/daemon/sessions/piSessionService.{fifo,realSdk.review-repro-ordering,daemonOrder.review-repro-ordering}.test.ts`, `operationLedger.review-repro-ordering.test.ts` |
| confirm | 13 | `src/client/src/components/{PromptEditor.send,ChatView.deliveryLabels}.review-repro-confirm.test.ts` |
| realtime | 9 | `src/client/src/{controllers/sessionController,sessionGapRepair}.review-repro-realtime.test.ts`, `src/server/daemon/realtime/sessionEventHub.review-repro-realtime.test.ts`, `src/server/web/sessionProxyRoutes.review-repro-realtime.test.ts` |
| reads | 7 | `src/client/src/api/http.review-repro-reads.test.ts`, `pi-web-plugins/{subagents,goals}/pi-web-plugin.review-repro-reads.test.ts` |

These tests are the acceptance criteria: each phase below is done only when its repros pass
unchanged.

**The owner's incident, reconstructed from records.**
- `bb91254c` was accepted at 23:05:00 without a delivery kind, because the phone believed the
  session idle. It was parked as a follow-up.
- Five later messages, sent as steer, reached the agent first. `bb91254c` reached it only at
  23:14:49.
- The operation ledger recorded it as `succeeded` at 23:05:00.838.
- At 22:56 the phone's POST died mid-body (`400 aborted`), and the bubble sat on "No answer yet"
  for six minutes. Nothing asked the daemon.

## Four root causes

Every finding is an instance of one of these.

**1. Decisions are made from a stale local copy instead of a fact.**
- The daemon routes on the runtime's `isStreaming`. In the real SDK that flag is false while a
  prompt runs its preflight, so a second prompt goes straight in, collides, and is refused after
  it was reported accepted (ordering F1, proven over the real SDK and live).
- The daemon's routing ignores the backlog it already holds: parked, compaction-held, or
  draining (ordering F2a–d).
- The browser picks the delivery kind from its own status copy (realtime F11), and that copy can
  be ~45 s stale while the socket is silently dead (realtime F1).
- An outbox replay takes its attachment delivery from whatever the composer holds now
  (confirm F3).

**2. Facts carry no order.**
- Acceptance has no sequence number and is decided after `await`s, so a photo is overtaken by
  later text (ordering F3).
- Status has no revision, so an older HTTP read overwrites a newer frame (realtime F2).
- Frames published between the snapshot and the subscription are lost undetected (realtime F3).
- Watermarks have no epoch, so a restarted daemon or an evicted ring replays with a hole
  (realtime F4, F8).
- The same frame can be applied twice or out of order (realtime F6, F7).
- Reads carry no request identity, so a late answer overwrites a newer one; polls stack up
  (reads F2, F3).

**3. States with no exit (absence read as negation).**
- `unverifiable` has no clock exit and is re-checked only on reconnect (confirm F2).
- The HTTP deadline ends at the response headers, so a stalled body keeps a panel "Reading…"
  forever (reads F1).
- The web proxy has no deadline towards the daemon (realtime F9).
- A prompt refused after acceptance gets no per-id terminal frame (ordering F6).
- After a restart, parked prompts drain only when someone opens the session (ordering F8).
- A failed read is shown as empty or hidden, or wipes the rows already shown (reads F4, F6, F8).

**4. The ledger's words mean the wrong thing.**
- `succeeded` means "accepted", not "consumed" (ordering F4e).
- Recall, stop and restore delete rows, so a retry re-runs the message (ordering F4a–c).
- A full ledger silently stops recording (ordering F4d).
- 5xx is classified as a definite refusal, so the retry mints a new id and the message runs
  twice (confirm F1).
- One composer can have two sends in flight at once (confirm F4).

## Design

### Daemon: one inbox per session

- **Sequence on arrival.** A synchronous acceptance step runs at request entry, before any
  `await`: it assigns `seq` and appends to the session's inbox. All later work for that session
  runs on one serial chain.
- **One FIFO, one consumer.** The inbox is the only queue pi-web owns; the owned queue and the
  compaction queue fold into it. It is persisted in `$PI_WEB_DATA_DIR`, keyed by
  machine+session, not in the workspace (ordering F9). One consumer hands entries to the
  runtime in `seq` order.
- **A real handoff fact.** The consumer passes `preflightResult` to `session.prompt`, so
  "handed" is an SDK fact rather than a guess from `isStreaming`. It only trusts the
  `agent_settled` of the run it started, identified by a run token.
- **Pure decisions.**
  - `acceptanceRoute(facts)` returns `replay | park(seq) | reject(reason)`. There is no
    "direct" path while anything is ahead in the inbox.
  - `nextHandoff(inbox, runtime, steerPolicy)` returns `{entry, as} | wait`.
- **Ledger rows only move forward.** `accepted(seq) → handed → committed | withdrawn | refused`.
  Rows are never deleted; they expire by age, not capacity. Every terminal publishes a per-id
  frame (`prompt.committed`, `prompt.refused`, `prompt.withdrawn`).
- **Ordered status.** Status carries `{epoch, revision}`. A new subscription gets a join frame
  carrying the current `seq`. On startup the daemon scans inboxes and drains them without
  waiting for a browser.

### Browser: a store that reduces facts

- **Facts, not copies.** `reduceSession(state, fact)` takes only ordered facts: frames and
  snapshots with `{epoch, seq}`, status with `{epoch, revision}`, the join frame, socket
  liveness, and ledger outcomes. It drops stale revisions, orders and dedupes frames, and
  resyncs on an epoch change.
- **The view is a function.** `view = f(state, localIntents)`. An unknown or stale status is
  shown as unknown, never as idle.
- **The composer sends intents.** An outbox record holds text, attachments, attachment delivery
  and identity. The delivery kind is decided by the daemon's inbox, never by the phone's status
  copy. A per-composer `sendGate` serialises sends and says why a send is waiting.
- **One error classifier.** `dispositionForError`: 4xx means refused; 5xx, timeout or a dropped
  link means unverifiable. A row that a server fact already proved (queued or later) is never
  deleted.
- **Unknown resolves on its own.** A verification effect asks the daemon's ledger at +5 s,
  +15 s and +45 s, and when the tab becomes visible.
- **Reads carry identity.** One `readLoop` per surface: a sequence number per read, one read in
  flight, stop when not rendered, keys that carry scope, and `reading | rows | empty | stale |
  failed` kept as distinct phases.
- **Deadlines everywhere.** The HTTP deadline covers the body. The web proxy has a deadline and
  forwards the browser's abort.

### The only impure code

A thin effect layer per side: socket and HTTP transport, localStorage, disk, timers, SDK calls.
It translates what happened into facts and executes what the pure functions decide. It makes no
decisions of its own.

## Phases

Each phase merges only when all of these hold:
- its repros pass unchanged;
- the full suite, lint and typecheck are green;
- the live probes pass on 8505;
- a fresh review lane finds no new failure.

| Phase | Scope | Repros it must turn green |
|---|---|---|
| 1 | Daemon inbox, ledger, per-id terminal frames, status revision and join frame, startup drain | all 18 ordering |
| 2 | Transport: body deadline, proxy deadline and abort, error disposition, verification effect, send gate, complete outbox records | 13 confirm + 2 realtime proxy + 1 reads http |
| 3 | Browser store: epoch, seq and revision reducer, gap repair per connection, ordered application, liveness shown | remaining 7 realtime |
| 4 | Reads: `readLoop` with identity, goals scope and failure state, subagents stale rows, `view`/`tool` route, remove the dead `/subsessions` read | remaining 6 reads |
| 5 | One vocabulary for delivery states (owner approves the words) | label repros in confirm |

## Decisions for the owner

1. **A steer arriving while earlier messages are still queued:**
   - A: while the agent runs, every message is a steer. One lane, FIFO by construction; no
     follow-up distinction.
   - B: the steer queues behind the waiting messages.
   - C: the waiting messages are handed first, in order, then the steer.
2. **The words for a sent message** (proposal):
   - "Sending…" while the request is in flight;
   - "Received" once the daemon has it;
   - "Checking…" while the verification effect asks;
   - "Not received · Retry" when the daemon says it never got it.

   "No answer yet" goes away.
3. **Release cadence.** Ship after phases 1+2, which cover loss, duplicates, order and stuck
   sends, or after all five.

## Owner decisions (2026-09-29)

1. **Steer.** While the agent runs, every message is a steer. pi-web's queue holds them,
   visible and recallable, and at the next gap hands everything waiting to pi together, in
   order. Each message stays its own transcript row with its own identity.
2. **Words.** Sending… / Receiving… / Received / Not received · Retry.
3. **Release.** One release after all five phases.

## Phase 1 implementation notes

**SDK facts (read from agent-session.js and pi-agent-core).**
- `preflightResult(true)` is called synchronously just before `_runAgentPrompt`, whose first
  line sets `_isAgentRunActive = true`. From the next microtask on, `isStreaming` is true.
- `prompt()` called while the SDK emits `agent_settled` is deferred and returns without
  calling `preflightResult`.
- After a run, `_runAgentPrompt` loops on `agent.hasQueuedMessages()`. A steer queued before
  that final check is delivered in the same run.
- `session.prompt(text, {streamingBehavior: "steer"})` while not streaming runs as a normal
  prompt.
- `agent.steeringMode` is an in-memory setter, separate from the saved pi setting. `"all"`
  drains every queued steer at one gap.

**The consumer (one per session, on one serial chain).**
- **Accept.** A synchronous step at request entry assigns `seq` and appends to the inbox. The
  ledger records `accepted`.
- **Hand.** `nextHandoff(inbox, runState)` decides:
  - inbox empty → nothing;
  - compacting → wait;
  - a direct prompt is being handed → wait;
  - running → at a gap (`turn_end`, `tool_execution_end`), hand every waiting entry, in
    order, as a steer;
  - idle → hand the head as a direct prompt.
- **Handed.** A direct prompt counts as handed at the first of `preflightResult(true)` and the
  prompt promise settling. The latter covers the fake runtime and the deferred path.
- **Refused.** A transient refusal (compaction in progress, "already processing") keeps the
  entry at the head and waits for the next fact. A terminal refusal (no model, no auth)
  publishes `prompt.refused`, records `refused` in the ledger, and withdraws the entry's
  commit expectation.
- **Settle safety net.** On `agent_settled`, anything pi still holds in its steering queue is
  taken back (`clearQueue`) to the head of the inbox, keeping identities.
- **Steering mode.** Set to `"all"` on pi-web-hosted sessions only, in memory.

**Repro fixture adjustments (the assertions themselves are unchanged).**
- S1 and S2 assert behaviour of the raw SDK (`session.prompt` with no daemon). pi-web cannot
  change it. They stay `it.fails`, renamed "SDK behaviour the daemon works around": they fail
  for as long as the SDK behaves this way, and an upgrade that changes it turns them red.
- I4 used "already processing" as its refusal. That is transient under the new consumer, so
  the fixture now uses a terminal refusal ("No model selected."). The invariant (a refused
  id's identity is not inherited) is asserted as before.
- I3-restart and I1-recall-window were written when a steer went to pi at once. Under the
  owner's rule it waits for a gap, so each fixture emits `turn_end` where it needs the steer
  to be in pi's queue (I3-restart before its first check; recall-window after S3 and again
  after the recall).
- I1-restore-first gives its service a data directory, because the inbox now lives there;
  the parked prompt is still written to the old workspace location, so the test also covers
  the migration.

## Phase 1 as landed

**Done.**
- One inbox per session in `$PI_WEB_DATA_DIR/inbox/<sessionId>.json` (`{cwd, entries}`),
  written before `prompt.accepted`. Every prompt passes through it, so a read-only workspace no
  longer refuses prompts. A legacy `<cwd>/.pi/queued-prompts` file is merged in and deleted on
  open.
- Acceptance runs on a per-session chain joined synchronously at request entry (I2).
- `nextHandoff` and `refusalKind` in `promptHandoff.ts`, enumerated in its test. The consumer
  runs one decision at a time per session under the queue lock, so a recall's replay and a
  handoff cannot interleave.
- The compaction queue is gone; compaction is a run state the consumer waits on.
- `takeBackStrandedMessages` on `agent_settled`; `steeringMode = "all"` at bind.
- Ledger: rows are never deleted (stop, close, recall and refusal used to delete); capacity
  512 → 10 000 as a safety net with age expiry doing the work; outcomes `pending → succeeded
  | failed | withdrawn`. `withdrawn` answers a retry as a duplicate; `failed` and `unknown`
  re-admit it (see `READMITTED`). Succeeded is settled from runtime facts, not from the commit
  stamp (see triage O1).
- The commit expectation is recorded when a message is handed, and withdrawn whenever it comes
  back (see triage O5).
- Startup drain: `resumeWaitingInboxes()` opens every session with a waiting inbox.

**Moved to later phases, with their consumers.**
- Status `{epoch, revision}` and the session join frame → Phase 3. Only the browser store
  consumes them, and the repros that prove them (`sessionEventHub`, `sessionController`
  realtime) are Phase 3's.
- `prompt.refused` per-id frame → Phase 2. The browser parser rejects unknown frame types, so
  the frame lands with the client disposition that uses it. Until then a terminal refusal
  publishes `session.error` as before and the ledger answers `failed`.

**Existing tests changed because the owner's rule changed the behaviour they pinned.**
- `ownedQueue.test`: "delivers a busy steer immediately" becomes "hands everything waiting at
  a gap, in order, as steers"; queue files are checked in the data directory.
- `compactionIdentity.test`: a message waiting through compaction into a running agent is
  handed as a steer, not a follow-up.
- `promptQueue.test`: messages sent during compaction are echoed at acceptance and listed as
  steers; the second is handed at the next gap, not at `agent_start`.
- `acceptanceLedger.test`: the eviction and forget-on-close tests pinned the two ledger bugs
  the review proved; they are replaced by forward-only tests.
- Tests that asserted a handoff synchronously after `await prompt()` now wait for it:
  `prompt()` resolves at acceptance, and the handoff follows on the consumer.


## Phase 1 review triage (lanes: ordering / Opus 5.5, lifecycle / DeepSeek 4.1 max)

Each claim was checked against `piSessionService.ts` and the SDK sources before it was sorted.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| O1 | "succeeded" came only from the commit stamp, which matches on text; a photo (resize hints), a template, an input handler or an extension command commits under other text or none, so the row stayed pending, and after a restart `unknown` re-admitted a retry that runs twice | TRUE | Fixed: rows settle from facts. Direct: the first user `message_start` after preflight, or the prompt resolving. Steer: its lane in pi shrinks past it at a user `message_start` (`_queueSteer` stores the committed text, and the SDK removes it before emitting). The stamp only carries the id |
| O2 | The SDK clears its run flag before awaiting extension `agent_settled` handlers; a nudge in that window hands a direct prompt (deferred by the SDK, invisible, reordered) or starts a run ahead of a stranded steer | TRUE | Fixed: a `settling` run state from `agent_start` until pi-web sees `agent_settled` (bounded by a 5 s grace so a missing event cannot stall the inbox); stranded steers are taken back on every idle decision, not only on `agent_settled` |
| O3 | An idle handoff that races another run (ask answer, subsession notice) passes preflight, then `agent.prompt` throws "already processing a prompt"; the entry was gone | TRUE | Fixed: a transient rejection after the handoff puts the entry back at the head, and waits for the next fact. "Running" now also reads `agent.state.isStreaming`, because the refused prompt's `finally` clears the session flag and emits a spurious `agent_settled` while the other run streams (the S2 SDK behaviour) |
| O4 | Clear and Stop were not serialised with an in-flight steer batch; a steer mid-handoff could land after Stop as a new run, or after Clear as a message reported withdrawn | TRUE | Fixed: Clear and Stop wait for the in-flight steer batch (steer handoffs are short) before they snapshot and clear |
| O5 | Recording the commit expectation at acceptance let another source's commit with the same text claim a waiting message's id | TRUE | Fixed: the expectation is recorded when the message is handed and withdrawn whenever it comes back (refusal, take-back) |
| O6 | A rebind registered waiting messages' expectations twice | TRUE, narrow | Fixed: moot after O5; `expect` also ignores an id it already holds |
| L1 | Close (`stop`) cleared pi's lanes; steers handed but unread were destroyed, and their pending rows answered the retry as a duplicate | TRUE | Fixed: close takes pi-held messages back into the inbox, with their ids, before the runtime goes; the next open hands them |
| L2 | `/reload` re-syncs queue modes from settings and reverts `steeringMode` to one-at-a-time | TRUE | Fixed: `steeringMode = "all"` is re-applied before every steer batch |
| L3 | An extension command's handoff holds the consumer for the command's whole run, so messages sent meanwhile wait for its end instead of steering at its gaps | TRUE | Fixed for slash commands: a slash-prefixed direct handoff counts as handed once a run starts. Not applied to plain text, where the same signal would let a later message overtake a refused one (O3) |
| L4 | A tree navigation starting while a message is being accepted makes the handoff throw, classified terminal, and the message was dropped | TRUE, narrow | Fixed: that refusal is transient |
| L5 | The client's unverifiable-row check ignores the new `withdrawn` outcome | TRUE | Phase 2 (client disposition) |
| L-note | `takeBack` uses `clearQueue`, which also drops custom messages queued with `deliverAs` (ask answers, subsession notices) stranded at the same instant | TRUE, very narrow (both must miss pi's final poll together) | Not fixed: the SDK has no string-lanes-only clear. Recorded as a known limitation |
| L-note | `handing → wait` is effectively unreachable because handoffs are chained | TRUE observation | Kept: harmless, and it states the rule if the chain ever changes |

**Fixture adjustment.** I4 now waits for the handoff before emitting `message_start`: the expectation is recorded at handoff (O5), and a real commit always follows its handoff. Assertion unchanged.

## Phase 1 fresh-lane triage (Opus 5.5, over 16a7cc79)

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| F1 | A steer was recorded before `session.prompt`; pi pushes it to its lane only after the command and input-handler awaits. A user `message_start` in between settled the in-flight record as read, and it lost its id. Recall's replay has the same window | TRUE | Fixed: a steer is recorded in its preflight callback, which the SDK calls right after `_queueSteer` pushed it; consumed steers are not settled while a recall replays the lane, and are settled once it is done |
| F2 | A steer decided at `agent_end` could reach `session.prompt` after the I/O of `take`, inside the SDK's `agent_settled` deferral; the deferred prompt's later refusal bubbles out of the finished run's prompt, which was then restored and run again | TRUE | Fixed twice over: the run state is re-read synchronously right before each `session.prompt` (a steer only into a running agent, a direct prompt only into an idle one, else back to the head); a handoff whose own message the agent already read is never restored, whatever its promise says later |
| F3 | Stop/Clear snapshotted and settled before awaiting the inbox clear, and cleared pi's lanes after it; a message read during the await was announced withdrawn and handed back | TRUE | Fixed: the inbox is cleared first, then the in-flight batch is awaited, then settling, snapshot, lane clear and withdrawals happen in one synchronous step |
| F4a | Any `agent_start` released a slash handoff, including another source's run | TRUE, theoretical | Fixed: only a registered extension command is released at run start; those run whether or not the agent is busy, so they are never refused as busy afterwards |
| F4b/c | One commit slot per session: a prompt refused after preflight could be marked read by another run's message, and a command finishing its preflight late could overwrite a direct prompt's slot | TRUE, narrow | Fixed: the slot is taken only when the agent's loop is idle at preflight. The SDK starts the loop synchronously after preflight, so that prompt's run is certain, and any later preflight sees the loop busy |
| F5 | pi's lanes are text-only; a user steer queued by an extension (`deliverAs: "steer"`) shares the lane and can shift position-based identity | TRUE, very narrow | Not fixed: pi-web cannot tell a foreign steer from its own. Known limitation, recorded here |
| F2-note | A steer that turns into a new prompt because the agent went idle inside the SDK's own awaits keeps the batch open through `_checkCompaction`, so Stop waits for it | TRUE, narrow | Not fixed: needs the agent to go idle during the few milliseconds of a steer's preflight |

## Phase 1 second fresh-lane triage (DeepSeek 4.1 max, over 0124292f)

The lane audited every earlier disposition against the source and found them holding. Hunt items 1, 4, 6 and 7 were adjudicated FALSE with reasons (no livelock: every state that defers a handoff is ended by an event that pumps, plus the 2 s heartbeat).

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| A | Stop/Clear clears the inbox, then awaits the in-flight batch; the batch's transient restore lands after the clear, so the restored message is withdrawn on every device and handed back, yet stays in the inbox and runs | TRUE | Fixed: while a session empties its queues the consumer hands nothing, and the inbox is cleared again after the batch finished, so a late restore is discarded with the rest |
| B | The preflight callback recorded what the daemon asked for, not the path the SDK took after its own input-handler await: a direct prompt the SDK queued as a steer settled succeeded unread and lost its id and photo on take-back; a steer the SDK ran as a new prompt was recorded as a lane entry and was not protected by the committed rule | TRUE | Fixed: the callback reads the SDK's own run flag at preflight (the SDK calls it right after `_queueSteer`, or right before `_runAgentPrompt`), records a held steer or a run accordingly, and the prompt's resolution settles succeeded only for a run |
| C | A prompt handed inside the SDK's `agent_settled` deferral (reachable once an extension `agent_settled` handler outlasts the 5 s grace) resolves without preflight and was settled succeeded; if its deferred re-run is refused it is lost | TRUE, not reachable today (no plugin registers `agent_settled`) | Fixed: the run state also reads the SDK's `_isEmittingAgentSettled` right before `session.prompt`, so nothing is handed into the deferral; a prompt that resolves without preflight is left pending, not succeeded. The SDK field is pinned by a real-SDK test so an upgrade that renames it fails |

## Phase 1 gate-lane triage (Opus 5.5, over 43fc5623)

No new failure from 43fc5623; every earlier fix held against the source. Ten hunt items were adjudicated FALSE with reasons. It found one older, unrecorded problem and one incomplete fix:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| P1-1 | A slash command (or input a handler consumes) handed while the agent runs reaches preflight on the SDK's "handled" path with the run flag set, so it was recorded as a steer in pi's lane; the phantom record shifted ids by position (Stop withdrew the command under S1's id and settled S1 read; an idle take-back restored the command in S1's place) | TRUE, since phase 1 | Fixed: a third landing, `handled`. A handoff counts as queued only if pi's lanes grew while it was being handed (`_queueSteer` emits `queue_update` synchronously before preflight); otherwise the run flag tells a run from a handled command |
| P2-1 | Fix C counted the SDK's `agent_settled` emission only as settling, but "running" outranks settling, so a steer could still enter the deferral while the agent loop flag was set | TRUE, same precondition as C | Fixed: while the SDK emits `agent_settled`, the agent does not count as running |
| P2-2 | Recalling a message pi still holds after its run ended replayed the survivors as new runs, awaited under the queue lock | TRUE, since before phase 1, narrow | Fixed: when the agent is not running, recall first takes pi's messages back into the inbox and recalls from there |

## Phase 1 second gate-lane triage (DeepSeek 4.1 max, over 78d988c6)

No P0 or P1, no lost message, no ordering break. P2-1 and P2-2 re-verified; eight hunt items adjudicated FALSE with reasons.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| G1 | Lane growth counted both lanes, so a command handler that injects a follow-up (`sendUserMessage`, the busy path measured in docs/sendusermessage-no-turn.md) made the command look queued | TRUE, new | Fixed: a registered extension command is always `handled` (the SDK runs commands before any queueing), and growth counts the steering lane only, the only lane pi-web hands into. A handler injecting a steer during a non-command handoff stays indistinguishable (F5) |
| G2 | A registered command in a steer batch held the batch until its handler returned; Stop runs `emptyQueues` before its abort, so a handler parked on a dialog blocked Stop until the dialog was answered | TRUE, pre-existing | Fixed: inside a steer batch a registered command counts as handed once invoked; its outcome settles when its handler returns |
| G3 | A handled command left a commit expectation that no commit consumes, claimable later by a same-text message | TRUE, pre-existing | Fixed: a `handled` landing withdraws its expectation |
| G4 | pi's display lane keeps a steer until `message_start`, but agent-core drains it at the loop poll, and `prepareNextTurn` (where between-turn compaction runs) sits in between: a recall or Clear during that compaction took back or withdrew a message the loop still commits | TRUE, pre-existing | Fixed: when pi shows lane entries but agent-core's queues are empty, the loop holds them; recall answers "already gone" and Clear leaves them to be read. Stop still hands them back, as pi's own TUI does, because its abort ends the loop before they are committed |

## Phase 1 third gate-lane triage (Opus 5.5, over 553cc23e)

Verified against the SDK: after `prepareNextTurn` the agent loop emits `message_start`/`message_end` for the messages it drained without checking the abort signal (agent-loop.js 93-118), and an aborted auto-compaction returns `false` instead of throwing (agent-session.js 2250-2276). `hasQueuedMessages` counts the follow-up queue too (agent.js 203), where pi-web's own ask answers and subsession notices go.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| A | Stop handed back and withdrew steers the loop had already drained; the aborted compaction returns and the loop commits them anyway | TRUE, P1 | Fixed: loop-held steers are never taken by Stop or Clear; they settle succeeded (the loop commits them whatever happens) and keep their commit expectation so the stamp still finds them |
| B | Close restored loop-held steers to the inbox file; the aborted loop committed them, and the next open handed them again | TRUE, P1 | Fixed: close's take-back skips loop-held steers and settles them succeeded, since pi-web's listener is gone when the loop commits them |
| C | "Held by the loop" was judged from `hasQueuedMessages`, which a queued follow-up (subsession notice, ask answer) makes true | TRUE, P1 | Fixed: held is counted per lane, oldest first: pi's displayed lane minus the user messages still in agent-core's queue for that lane. Custom messages and the other lane no longer count. The SDK fields read are pinned by the real-SDK test |
| D | Command names were split at any whitespace; the SDK splits at the first space only, so "/tidy\nnow" was taken for a command while pi queued it as a steer | TRUE, P2 | Fixed: parsed exactly as `_tryExecuteExtensionCommand` does |
| E | Inside a steer batch, a command whose handler later injects a steer can have that injected steer land after the batch's later steers | TRUE, P2 | Not fixed: the command's own text never reaches the agent, so no accepted message is reordered; this is about messages a command derives. Recorded as a known limitation for the owner to decide |

The G4 test's Stop assertion pinned the wrong behaviour (its fake had no loop); it now expects Stop to leave loop-held steers alone.


## Phase 1 fourth gate-lane triage (DeepSeek 4.1 max, over 0695b7e6)

Verified A's premise, the recall order, close's early return, and the command-name parse against the SDK; eight hunt items adjudicated FALSE.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| P1-1 | The loop-held count read `peek()`, which is the next drain: in one-at-a-time mode (agent-core's default for both queues, and the steering lane after a `/reload`) only the head, so still-queued messages counted as taken, were settled read, cleared by Stop, and lost. Latent on the owner's machine because its pi settings set both modes to `all` | TRUE | Fixed: the count reads the queue's own `messages` array; the real-SDK test pins that field |
| P2-1 | pi calls listeners inside the agent loop without a catch; a throw in pi-web's listener between a drain and the commit fails the run and loses the drained messages, which the loop-held rule has settled read | TRUE | Fixed for pi-web's listener: its handling is wrapped and a fault is logged. A throw inside the SDK's own `prepareNextTurn` stays a known limitation |
| P2-2 | At close the loop commits loop-held messages during the abort, after pi-web unsubscribed and forgot the commit expectations, so the committed copy had no id | TRUE | Fixed: a stamp-only listener stays attached through the abort, and expectations are forgotten after it |
| P2-3 | `queuedMessagesWithClientIds` lost its only caller | TRUE | Removed |


## Phase 1 fifth gate-lane triage (Opus 5.5, over 77464ecc)

No P0 or P1. The previous round's three fixes were verified against the SDK (agent-core awaits every listener, so the stamp-only listener sees the loop's commits before the abort returns). Seven hunt items adjudicated FALSE.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| F1 | Close forgot the whole session's commit expectations after its abort; a runtime reopened under the same session id meanwhile lost its own, and its commits went unstamped | TRUE, widened by 77464ecc | Fixed: close forgets only the expectations its runtime left, and drops per-session inbox state only when no newer runtime has taken the id |
| F2 | Daemon shutdown (`dispose`) did none of what close does: unread steers pi held died with the runtime, and loop-held steers were committed unstamped with their rows pending, so after the restart a retry ran them again | TRUE | Fixed: shutdown takes pi's unread messages back into the inbox file (the next daemon hands them) and stamps what the loop commits during the abort |
| F3 | A ledger write failing when a direct prompt was read threw before the handoff was marked handed, so the consumer stayed "handing" for the whole run and nothing was steered | TRUE, narrow | Fixed: the handoff is marked handed before the ledger write |


## Phase 1 sixth gate-lane triage (DeepSeek 4.1 max, over f0689d7d)

Verdict PASS with notes: no P0, no invariant failure its tests can see. The teardown ordering, the atomic take-back, restart re-recording and the take-back order were verified; nine hunt items adjudicated.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| P1-1 | A session reopened while its old runtime was still closing shared state keyed by session id: the old close could forget the new runtime's queue memory or commit expectations, or leave its own open-run state to stall the new one's handoffs | TRUE, a race | Fixed at the root: a reopen of a session id waits until that id's close has finished (opens already pending when the close began are awaited by the close instead). The gate 5 F1 test is rewritten to pin this: a prompt sent during a close opens nothing until the close ends, then lands stamped |
| P2-1 | A restore landing after a session closed found no file path and wrote to memory only | TRUE | Fixed: closing drops the queue's entries from memory but keeps its file path and write chain |
| P2-2 | Closing and shutdown awaited the take-back without a bound or a catch; a handoff that never settles held them open, and a failing write skipped the runtime's abort | TRUE | Fixed: the take-back is bounded (5 s) and never throws; the abort and disposal always follow |
| P2-3 | A handoff counted as handed and then refused as busy goes back to the head while a younger message may already be in pi's lane | TRUE, narrow trigger | Known limitation 6 |


## Phase 1 seventh gate-lane triage (Opus 5.5, over 94bf871e)

Two P1 problems, both introduced by the sixth-gate fixes, and two P2.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| P1-A | A reopen waiting on close 1 re-read the lock in `create()` and found it combined with close 2, which itself waited for that reopen: deadlock, and the id could never reopen | TRUE | Fixed: an open waits only for the close it saw when it was requested, and never re-reads the lock |
| P1-B | `forgetSession` dropped the queue's memory but kept its path, so a late restore wrote its entry over everything else in the file | TRUE | Fixed: a close no longer drops the queue's memory at all; every mutation persists before it updates memory, so memory already matches the file |
| P2-A | After the take-back gave up at 5 s and the id reopened, the old runtime's late batch and take-back cleared the new runtime's batch marker, settled its unread steers as read, and deleted its steer records | TRUE | Fixed: late work of a runtime that no longer owns its session id records, settles and takes back nothing, and a batch clears only its own marker |
| P2-B | The closing lock was held through the abort; an abort that never finishes blocked the id's reopen forever and daemon shutdown with it | TRUE | Fixed: the lock releases when the close finishes or after 10 s, whichever is first |


## Phase 1 eighth gate-lane triage (DeepSeek 4.1 max, over ea2ed475)

No P0. All four gate-7 fixes verified, including that open/close waits now form an acyclic graph. Six hunt items adjudicated FALSE.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| P1-1 | A direct handoff between the inbox and pi when the session closed ran on the torn-down runtime: unseen, unpersisted, and settled succeeded, with nothing to hand it again. Close waited for steer batches but not for a direct handoff | TRUE, pre-existing | Fixed: teardown waits for the whole handoff chain (within its 5 s bound), and a handoff re-checks right before `session.prompt` that its runtime still serves the session id; if not, the message goes back to the inbox for the next runtime |
| P2-1 | `open()` deduplicated id-less entries by lane, text and millisecond and persisted the result, erasing a real second message | TRUE | Fixed: memory, which always matches the file, is the queue's truth; `open()` only adds legacy entries not already known by id |
| P2-2 | The gate 7 P2-A disposition overstated its fix: a late handoff of a replaced runtime could still record a commit expectation and take the one-slot commit watcher | TRUE | Fixed: a handoff whose runtime no longer serves the id stops before any bookkeeping, and the commit watcher is taken only by the owning runtime |


## Phase 1 ninth gate-lane triage (Opus 5.5, whole inbox over 0380b287)

A whole-inbox review that walked every user journey end to end. Every recorded fix held. The lane found one P1 and three P2, all true and all fixed; each has a test that fails on 0380b287. The lane-array private state the F4 fix uses is pinned in the real-SDK test.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| F1 (P1) | pi's lane holding a steer without an id next to one with an id gave the id to the wrong lane position. Stop then returned one message twice and lost the other, and close restored the duplicate into the inbox. An id-less send happens when a pending send is flushed to a session that is not selected | TRUE | Fixed: every steer pi holds gets a held-steer record, so lane positions correlate one to one. An id-less steer gets a local id that starts with a space, which no accepted client id can (they are trimmed). It is never published, settled or withdrawn |
| F2 (P2) | Stop while a direct handoff was before its run (pre-prompt compaction, input handlers, image preparation) aborted nothing. The SDK then started the run anyway, and it ignored the Stop | TRUE | Fixed: Stop waits, within the 5 s handoff bound, for such a handoff to land. The wait ends at the commit, not at the end of the run. Stop then aborts the run it started. The message was already handed, so it stays delivered and the run is stopped |
| F3 (P2) | Messages waiting for a closed session could be archived with it and later run inside the archived session at startup. A deleted session's waiting messages failed to resume at every start | TRUE | Fixed: bulk archive, cleanup and archived delete refuse or skip a closed session with waiting messages, the same rule an open one already has; opening it delivers them. The inbox hands nothing to a runtime opened to read an archived session, and startup resume skips archived sessions |
| F4 (P2) | pi removes a read message from its shown lane by text and skips empty text, so a photo-only steer stayed shown after it was read. That held its own ledger row, and every later one, pending | TRUE (SDK) | Fixed: at a user message start with empty text, the daemon applies pi's own rule to the empty text: the same splice and queue update pi makes |


## Phase 1 tenth gate-lane triage (DeepSeek 4.1 max, over d6277414)

Verdict: **PASS: no P0 or P1.** The lane verified that no local hold id leaks from the daemon. It found F1 and F3 complete, and F2 and F4 correct in their mechanism. It reported three P2 items:

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| P2-1 | F4 was incomplete. The empty-text drop took the oldest empty lane entry. When an extension's empty-text follow-up was read, it could remove a photo-only steer still waiting in agent-core. The daemon then settled that steer succeeded, and Stop or close dropped it with no frame | TRUE | Fixed: the drop only removes an entry from the part of each lane the agent loop already took. The gate-9 F4 test now drains agent-core before its read, as the real loop does; its assertion is unchanged |
| P2-2 | A Stop during a direct slash command whose handler parks waited out the 5 s bound, then stopped nothing | TRUE | Fixed: Stop does not wait for a command handoff, the same rule gate 2's G2 set for a command inside a steer batch. Teardown still waits within its own 5 s bound (limitation 7) |
| Notes | (a) A direct handoff put back transiently while Stop clears is not announced; it waits and runs later. (b) `hasQueuedPromptClientId` was dead code. (c) `getArchived` compares cwd exactly, now also for the startup resume skip | (a) TRUE (b) TRUE (c) not reproduced | (a) Recorded as limitation 9. (b) Removed. (c) Pre-existing. A mismatch opens the session through the live path, which fails because the file is archived, so the messages keep waiting. Nothing is lost or run in the archive |

## Phase 1 acceptance (2026-09-29, at 2d214b0e)

All four merge conditions hold:
- **Repros:** the 18 ordering repros pass with their assertions unchanged. S1 and S2 stay `it.fails` as SDK behaviour the daemon works around. The status revision and join frame moved to phase 3, and the refusal frame to phase 2.
- **Suite:** the full suite is green (5748 passed, 32 expected fail for later phases, 5 skipped), and tsc, eslint and knip are clean.
- **Live:** `scripts/probe-inbox-order.mjs` passes 29/29 on 8505. It covers:
  - order under a running tool;
  - Stop hands messages back;
  - photo-only, id-less and named messages read mid-run;
  - daemon restart with a message waiting.

  The photo leg fails on a build of 0380b287: the named message's row stays pending for the whole run. So the check proves the fix, not just the path.
- **Review:** the tenth fresh gate lane passed with no P0 or P1, and every P2 it reported is fixed or recorded below.

Ten gate lanes found 13 P1s in all; each is fixed and pinned by a test that fails on the commit before its fix.

## Phase 1 known limitations

Each was found by a review lane, checked against the source, and left unfixed for the reason given.

1. **Foreign user steers share pi's text-only lanes (F5).** A steer queued by an extension (`sendUserMessage(..., {deliverAs: "steer"})`) sits in the same lane as pi-web's, and lane identity is by position. In the rare arrangements where a foreign steer is read or stranded out of order with pi-web's, an id can shift to the neighbouring entry.
2. **`clearQueue` also drops agent-core's custom messages (L-note).** Taking pi-held messages back uses the SDK's only clear, which also drops a custom message (ask answer, subsession notice) queued at the same instant. It needs both to miss the loop's final poll together.
3. **A steer that becomes a new run inside the SDK's own awaits keeps its batch open through `_checkCompaction` (F2-note),** so Stop waits for that compaction. It needs the agent to go idle during the few milliseconds of a steer's preflight.
4. **A command's derived steer can follow later steers in the same batch (gate 3 E).** Inside a steer batch a command counts as handed once invoked, so a steer its handler injects after an await can land after the batch's later steers. No accepted message is reordered. Waiting for handlers again would bring back Stop blocking on a handler parked on a dialog (G2). **Owner decision.**
5. **A throw inside the SDK's `prepareNextTurn` loses the steers the loop just drained (gate 4 P2-1).** The run fails before it commits them, and they were settled read when Stop or close met them held by the loop. pi-web's own listener can no longer cause this; an SDK-side failure there still can.
6. **A late busy refusal can put a message behind a younger one (gate 6 P2-3).** A handoff already counted as handed (a slash command released at run start) that is then refused as busy goes back to the head of the inbox, while a younger message may already sit in pi's lane and be read first.
7. **A take-back bounded at teardown can give up (gate 6 P2-2).** If a handoff does not settle within 5 s of a close or shutdown (an extension input handler that never returns), what pi still holds goes with the runtime; its rows stay pending, so after a restart a retry runs it.
8. **The closing lock has a 10 s ceiling (gate 7 P2-B).** A close whose abort never returns stops holding its session id after 10 s, so the id can reopen while the old runtime still winds down. The old runtime's late work leaves the new one's state alone, but both can then write the same session file.
9. **A direct handoff put back while Stop clears is not handed back (gate 10 note).** If the SDK refuses a direct handoff as momentarily busy at the instant of a Stop, the message returns to the inbox after Stop's clear. It shows as waiting and runs later, not withdrawn. Clearing again after the handoff would also withdraw messages sent after the Stop.

## Phase 2 as landed

**Scope.** Phase 2 takes the 12 transport repros:
- 4 composer (`PromptEditor.send`);
- 5 non-label confirm repros (`ChatView.deliveryLabels`);
- 2 proxy;
- 1 http.

The four confirm repros about words belong to phase 5, where the owner approves the vocabulary (see "Conflicts for phase 5" below).

**Proxy deadline (A).** `boundedDaemonRequest.ts` ends every proxied daemon call in one of three ways:
- with the daemon's answer;
- at `SESSION_PROXY_DEADLINE_MS` (25 s), with a 504;
- when the browser's connection closes.

The last two abort the call's signal, and the race does not rely on the daemon honouring it. The 25 s comes from measurement: over the last 1.5 GB of the production access log, the slowest session read took 22.6 s and the slowest prompt 6.1 s; 19 reads took over 2.5 s. The repro "a daemon that never answers…" raced the proxy against a 3 s real-time window, which any deadline that real reads survive exceeds. Its fixture now uses fake timers advanced past the default deadline, below the browser's 30 s; its assertion is unchanged.


**Body deadline (B).** `request()` keeps its deadline through the body read. A status the server did answer with still surfaces as its `HttpError`. `fetchWithDeadline` still ends at the headers, because its callers read the body themselves and one of them streams a terminal command's output for longer than any request deadline; phase 4's `readLoop` owns that.

**One classifier, and facts outrank answers (C–F).**
- `carriesNoVerdict` makes a 5xx unverifiable whatever the caller's predicate says. The daemon refuses with 400 or 404; a 5xx comes from a proxy, a gateway or a crash.
- The outbox records a timed-out send as `unverified`, and the session list marks `unverified` as well as `failed`. A stored state the table does not know is read as `stored`.
- `removeDeliveryLine` drops only a row no server fact proved (`PROVEN_BY_SERVER`). Recall and Stop, which act on the daemon's word, go through `withdrawDeliveryLine`. A refusal arriving after the acceptance frame keeps the row and reports the send accepted.
- A queued row an idle session no longer holds steps back to `received` (`leaveQueue`), never forward to `delivered`. The existing test that expected `delivered` now expects `received`: absence from a queue is an inference, and the transcript's committed copy is the fact.

**Send gate and complete records (G).**
- Each send is written to the outbox at once and handed over after the previous one settled. A failed send does not stop the chain.
- The upload flag no longer swallows a send, and the send button stays usable.
- A waiting send whose session the reader left is not handed to the new session; its record stays in its own session's outbox.
- Records carry the attachment delivery chosen at compose time. Older records answer from their own attachments.

**Verification effect and refusal frame (H, I).**
- `sendVerification.ts` decides what each ledger answer does to an unverifiable row:
  - `pending` or `succeeded`: received, and the outbox lets go;
  - `failed` or `unknown`: not received, and Retry keeps the identity;
  - `withdrawn`: the row leaves, as it does for the withdrawal frame;
  - no row: wait, until the last ask calls it not received.
- The controller asks at 5 s, 15 s and 45 s after the send gave up, and again when the tab comes back.
- The daemon publishes `prompt.refused` per identity when the runtime refuses a message the inbox accepted. The frame is published only if the ledger actually recorded `failed`, so a run failing after the read is not reported as the message's refusal. The client marks that row failed. The outbox entry is not re-created, so a refused message is never replayed automatically on reconnect.


**Phase 2 first gate-lane triage (Opus 5.5, over 493d9701).** Confirmed sound:
- the proxy deadline, which settles once and never replies twice;
- the body deadline;
- the 5xx disposition;
- the proven-row refusal path, which cannot send twice;
- `refuse()`.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| P1-1 | A send waiting in the gate on a composer that was unmounted (a machine switch, or a cleared selection) still passed the scope guard, because a detached element's props never change. The controller then posted it to whatever session was selected, on another machine | TRUE, caused by the gate | Fixed at both ends. A send records whether its composer was on the page when written, and one taken off the page since is not handed over; its record stays in its own session's outbox. Every send also carries its recorded scope, and `controller.send` refuses a mismatched one with `SendScopeChangedError`, which the composer treats as "keep for its session", neither a refusal nor a failure. |
| P1-2 | A verification answer was applied to a row that changed while the ledger was being asked. A Retry that went out mid-ask was overwritten to `failed`, and a failed row never moves forward | TRUE, caused by the clock | Fixed: a step applies only to a row that is still `unverifiable` when the answer arrives |
| P2-1 | A row the runtime refused offers Retry, whose notice ("may already have been delivered") is untrue, because the accepted send already retired its outbox record | TRUE | Recorded for phase 5 (owner decision): Retry for a refused message is a words-and-semantics question. Discard hands the words back meanwhile, so nothing is lost. |
| P2-2 | After a stall of about 70 s before acceptance, the last ask can call a message not received that the daemon then accepts and runs, and `failed` never moves forward | TRUE (rare) | Recorded for phase 3. "A failed row never moves forward" dates from retries that minted new ids; retries now reuse the identity, so a later fact about the same identity should outrank an inferred failure. That is the browser store's reducer rule (facts outrank answers), which phase 3 builds. Retry recovers the row meanwhile. |


**Phase 2 second gate-lane triage (DeepSeek 4.1 max, over e67d4680).** Confirmed sound:
- the proxy and body deadlines, and `carriesNoVerdict`;
- `withdrawDeliveryLine` for recall and Stop, and `refuse()`;
- `stillUnverifiable`;
- the scope check, which cannot misfire for a stable selection because both sides read the same state (so `local` and remote machine ids agree);
- the auth slash-command path.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| F1 (P1) | The gate-1 P1-1 fix was incomplete. The composer element is reused, not remounted, across a session switch, so a send kept for its own session was never handed over again: only `firstUpdated` and the browser's `online` event flushed the outbox | TRUE | Fixed: the composer flushes its outbox whenever its session or machine changes. A flush interrupted by a switch flushes again for the new scope. |
| F3 (P2) | A replay re-posted an identity whose request was still in flight | TRUE for the waste; not true that it runs twice. `acceptPrompt` is serialised per session and checks the ledger inside, so the second copy waits for the first to be recorded and is answered as a duplicate. | Fixed anyway: a replay skips identities still in flight |
| F2 (P2) | Records under a session's old key (a browser-created session starting, or one recreated after its daemon copy vanished) were read by no surface | TRUE | Fixed: `moveOutbox` carries the records next to `moveDraft` at both id changes |
| F4 (P2) | A `prompt.refused` frame published while the reader is on another session reaches no socket, and the row later steps to received with no Retry | TRUE | Recorded for phase 3: frames only reach the selected session's socket. The store's join frame and per-identity facts on (re)join are where a missed terminal fact is recovered. |


**Phase 2 third gate-lane triage (Opus 5.5, over 6ed00a38).** Confirmed sound:
- no replay reaches another scope;
- switching creates no storm;
- `moveOutbox` runs before the selection moves;
- the in-flight skip, the proxy deadline, `refuse()` and `stillUnverifiable` hold.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| 1 (P1) | A replay ran beside the send gate, not in it. A message typed right after switching back could reach the daemon before the kept messages being replayed | TRUE | Fixed by one serializer. `enqueueSend` is the only way anything leaves a composer: a new send, a Retry and every replay are steps on one chain. A replay reads its session's records when its turn comes, so kept records go before anything typed after them. |
| 2 (P1) | The in-flight skip could strand a record: one moved to a session's new identity while its own send waited, or one kept while a replay for the same session was running, which refused the next flush | TRUE | Fixed by the same chain. Keeping a send for its session queues a replay, and a replay queued behind a running one is no longer refused. At most one queued-but-not-started replay exists, and it covers every record present when it runs. |
| 3 (P2) | An automatic replay of a record whose ledger outcome is `failed` would be answered "duplicate, accepted" | Not true | The ledger re-admits a `failed` identity (`READMITTED.failed`), so the replay is accepted again and runs once more. If the runtime refuses it again, the row shows `failed` from the refusal frame and the record is gone, so there is no loop. At most one automatic re-attempt of a message the client only knew as unverified. |

The same lane noted, outside phase 2's diff, that a send to a session still starting drops its identity and retires its outbox record as soon as it is queued in the browser. That belongs to phase 3's store.


**Phase 2 fourth gate-lane triage (DeepSeek 4.1 max, over 37a93fb9).** Verdict: **PASS, no P0 or P1.**

Checked and found to hold:
- the chain cannot stall, because every step is bounded by the request deadline and a rejected step cannot strand the tail;
- `replayQueued` cannot stick;
- a Retry is never refused forever, and running after a newer send is acceptable, because it is a fresh acceptance under its own identity;
- a replay reads the scope current when it runs, and never sends one session's records to another;
- a restore after a refusal never overwrites a newer draft or reaches another session;
- every recorded fix is present and complete.

| # | Finding | Verdict | Disposition |
|---|---|---|---|
| P2-1 | A recreate that finished after the reader switched machine returned before moving the draft and outbox, leaving them under the dead id | TRUE | Fixed: both are moved under the session's own machine keys, and the dead id is forgotten, before the machine check that keeps the selection where the reader is |
| P2-2 | `enqueueSend` set the chain's tail only after starting a first step, so a step queuing another from inside itself would queue it beside itself | TRUE, latent | Fixed: the tail is in place before a first step starts, which still starts at once |
| P2-3 | Discard left the record's in-flight mark behind | TRUE | Fixed |

## Phase 2 acceptance (2026-09-29, at the commit that records it)

All four merge conditions hold:
- **Repros:** the 12 transport repros pass with their assertions unchanged. The proxy repro's clock is now fake timers, recorded above. The 4 label repros are phase 5's.
- **Suite:** the full suite is green: 5811 passed, 20 expected fail for later phases, 5 skipped. tsc, eslint and knip are clean.
- **Live:** `scripts/probe-transport.mjs` passes 5/5 on 8505. The never-received leg is proven to fail on 2ab0a6cf, the commit before the verification clock.
- **Review:** the fourth fresh gate lane passed with no P0 or P1, and its P2s are fixed.

Four gate lanes found 6 P1s, each fixed and pinned by a test that fails on the commit before its fix.

Recorded for later phases:
- phase 3: the late acceptance after the last ask (P2-2); the refusal frame for a background session (F4); the identity of a send to a session that is still starting.
- phase 5: a refused row's Retry (P2-1) and the four label conflicts.

**Conflicts for phase 5 (owner decision).** Some confirm repros cannot all pass together:
- **The bubble's words.** "does not claim it may be running when the bytes never left" wants the bubble of an `unverifiable` row to read "Not sent". "gives the reader words for who is being waited on" wants "No answer yet" for the same input. The owner's words (Sending… / Receiving… / Received / Not received · Retry) match neither.
- **The received label.** "the label of a confirmation that is not a queue" wants a `received` row to read "Queued". The owner's words say "Received".
- **The state names.** "spells the state it waits in the same way as the bubble does" requires the outbox's states to be exactly the bubble's six, with no `unverified`. "records an expired deadline…" and "survives a state the table has no row for" (phase 2) require the outbox record to say `unverified`.

Phase 5 has to pick the words and then the spelling, and at least one of these assertions changes with the owner's approval.

## Phase 3 as landed

**Scope.** The 8 realtime repros:
- 2 for the hub's epoch;
- 2 for gap repair;
- 4 for the controller's join, status order and delta refresh.

It also takes the status revision and join frame moved from phase 1, and the three items recorded for it.

**Epochs (3a).** The session event hub mints an epoch whenever a session's seq space starts: at the first publish or snapshot, and after an eviction, from a per-instance id.
- Live and replayed frames carry the epoch, and the stream snapshot returns it.
- `replaySince` answers a watermark cited with any other epoch, or none, with resync.
- The client persists its watermark as `{seq, epoch}` and cites both. A bare number stored by an older build reads back without an epoch, gets resync, and is replaced.

**Ordered application (3b).** `SessionGapRepair` is seeded with the snapshot's watermark.
- It sees gaps itself, including one before the first live frame.
- It fetches the missed range in its own epoch and applies replayed and held frames merged by seq, once each.
- A frame from another epoch, or a lower seq on one without an epoch, starts a new space.
- The join buffer goes through it, and every snapshot or delta refresh reseeds it.
- The seed plays the join frame's role: the snapshot is where the stream stands.

**Status order and the delta path (3c, 3d).**
- A status read carries `streamPosition`, the seq and epoch it was computed at.
- The controller keeps the position of the last status it applied, frame or read. `statusReadVerdict` drops an older read. A read without a position is dropped when a status frame landed while it was in flight, and a frame at or below an applied read's position is dropped too.
- The delta refresh carries unsettled rows forward, as the full refresh does.
- The machine-wide copy of a status frame is stamped with its session frame's position. That socket has no per-session seq, so an older copy that landed after a newer read overwrote it: the same C1 fault on the second socket, found while preparing the gate and proven by a test first.

**Recorded items (3e).**
- Facts outrank an inferred failure. A failed row moves to received, queued or delivered on a server fact about the same identity, and the committed copy makes it delivered. The old "never resurrect a failed row" rule dates from retries that minted new ids; three tests that pinned it now expect the fact to win.
- Missed terminal facts are asked for. After a join, on reconnect, on the verification clock and when the tab comes back, the ledger is asked about every open row. A row a server fact proved acts only on a terminal fact it missed: a refusal or loss marks it failed, and a withdrawal removes it.

**A refresh that replaces the view (3f).** Found while writing the limitations, and proven by a test before the fix.
- A reconnect refresh reads while live frames keep applying, and its result replaces the view. A frame newer than the snapshot vanished until the next frame revealed the gap, which a quiet session never sends.
- A seed below the machine's frontier in the same epoch now fetches the range again at once. During a repair, the repair in flight asks again from the new seed.
- Sequenced frames still queued for render when the view is replaced are dropped: the snapshot reflects them, or the new fetch brings them back. Before this, one could apply twice.
- A failed join routed its buffer and later frames around the machine. It now routes them through it, as a successful join does.

**Phase 3 known limitations.**
1. **A send to a session that is still starting lives only in memory until the session starts.** The composer's record is retired when the controller queues it, and the queued send carries no identity. A reload during the second or two a new session takes to start loses the message. Keeping the record until delivery needs the pending-start queue to settle every send on every exit path (a failed delivery that stops the flush, a discarded start, a thrown network error), or the composer's chain stalls on it. That is a redesign of pending start, left for later.
2. **The page and the snapshot are two reads.** A full refresh reads committed history and the stream snapshot in parallel. A message committed between the two reads can be in the page and also replayed after the snapshot's seq. This predates phase 3 and is not reproduced; a daemon read that returns both at one seq would close it.
3. **Found while probing, outside this phase: the web answers an unknown API path with the app.** `GET` or `POST` to any unknown `/api/...` path, including `/api/machines/local/...`, returns the document with 200 `text/html` instead of a 404. A caller that checks only the status reads success. The realtime probe's first frame-drop precondition passed this way while the web never forwarded the call. The probe now arms on the daemon's socket and requires the daemon's JSON reply. The fallback should exclude `/api/`.

**Phase 3 gate lane 1 (Opus) triage, at 519f2071.** Verdict BLOCK on two P1s. Each finding below got a test that fails on the code before its fix (b7459946) and passes after.

- **F1 (P1), a superseded selection's gap repair applied into the current view.** A replay for session A that landed after the reader chose B put A's frames into B's transcript. Every reseed can start a repair now, which made this reachable on every reconnect. Fixed: the machine's `apply` and `resync` act only while it is still the controller's machine.
- **F6 (P1), a carried waiting row duplicated its committed copy.** `carryUnsettledForward` matched only `meta.delivery`, and a committed page line carries the id as `meta.clientMessageId`. The live realtime probe found the same family: the delta replay held the waiting message's own `message.append` echo, so the row either stood twice or was merged and read "delivered" while the daemon still held it queued (`q1`, not committed). Fixed: a waiting row takes the place of its echo and keeps its state, becomes its stamped committed copy as delivered, or is carried as before. The two fixtures that could not see this (a committed line with a delivery; a delta replay of zero frames) got real page-line shapes in new tests; their assertions are unchanged.
- **F2 (P2), the reconnect and resume asks raced the reopen.** After a daemon restart the ledger reads `unknown` for a message still in the restored inbox until the reopen records it again. Asked in between, a queued row read "not received" with Retry. Fixed: the reconnect ask runs after the refresh, and `verifyUnansweredSends` waits for a refresh in flight (`TrailingRefreshCoordinator.settled`, which starts nothing).
- **F3 (P2), a text match overturned a failure.** An unstamped committed "continue" (an extension injection, a forwarded command) claimed a refused "continue" and called it delivered. Fixed: a failed row yields only to a copy stamped with its own id; otherwise the copy becomes a line of its own.
- **F4 (P2), two status frames in one render kept the older.** The pending map kept the last arrival, so a late machine-wide copy could replace a newer session frame. Fixed: a pending entry at or past the incoming position in the same epoch is kept.
- **F5 (P2), a new epoch first seen live.** The watermark filter compared seqs across epochs and dropped the restarted daemon's frames below the old snapshot's seq, and nothing asked for what the new space published before that frame. Fixed: the filter compares within an epoch, and the machine applies the frame and asks for one full read.
- **Hunt 2, a different-epoch seed during a repair.** Recorded, not changed: it needs an old daemon's reply to outlive a new daemon's full refresh, and the next reconnect heals it.

**Phase 3 gate lane 2 (DeepSeek) triage, at 1035a866.** Verdict PASS: no P0 or P1. It confirms both of lane 1's P1 fixes at the root. Each P2 is fixed with a test that fails first, or recorded with its reason.

- **A (P2): an unstamped commit of a failed message's own text adds a second row. Recorded, not changed.** Since F3, a failed row yields only to a copy stamped with its own id, and an unstamped copy with equal text becomes a line of its own. The case the lane raises is a copy that is the failed message itself but arrived unstamped. Only a daemon too old to stamp commits, or an id-less inbox entry, produces that, and this daemon stamps every commit it hands over. F3's case, a different message with the same words (an extension's "continue"), cannot be told apart from it by content. Claiming would call a refused message delivered; appending shows two rows. The owner decides which of these is the lesser wrong if it ever matters.
- **B (P2): the verification clock asked the ledger without waiting for a refresh. Fixed.** Asked right after a daemon restart, before the reopen re-records a restored inbox, the ledger's `unknown` marked a queued row not received. The timer's ask now waits on `TrailingRefreshCoordinator.settled` like the reconnect and resume asks.
- **C (P2, pre-existing): a recalled message came back after a delta refresh. Fixed.** The delta path applied the replay's `message.append` echo but dropped its `prompt.withdrawn`, which is not a transcript event. So a recalled queued message stood again as a plain line, and a reload kept it, because the persisted watermark picks the delta path again. The replay's withdrawals and refusals now apply to the rebuilt transcript before waiting rows are carried.
- **D (P2, pre-existing): a failed row vanished on any rebuild. Fixed.** `carryUnsettledForward` carried only waiting rows, so after a reconnect the "Not received · Retry" bubble was gone while its outbox record stayed. A failed row is now carried like a waiting one. A copy stamped with its id still settles it.
- **E (P2): a repair that spans a daemon restart. Fixed.** Held frames from a new epoch were merged with the old epoch's replay by raw seq, and could be dropped as reflected by the old watermark until the follow-up resync. Now, when a held frame belongs to another epoch, the stale replay is discarded, the new space is entered, its held frames apply in order, and one full read is asked for.
- **Fixture notes.** The `epoch` key in the refreshRace `streamSync` fixtures is decorative, since the parser keeps no epoch on a sync reply; recorded. The G1 repro's assertion message says "the held copies win and keep the wire arrival order". It describes the defect the repro caught, not the machine now, and repros turn green without changing their assertions, so it stays.

## Phase 3 acceptance

Phase 3 meets the acceptance bar:

- **A fresh gate lane with no P0 or P1.** Gate lane 2 (DeepSeek) passed at 1035a866. Gate lane 1 (Opus) blocked on two P1s, both fixed in 1035a866; lane 2 then confirmed those fixes at the root.
- **Every P2 fixed or recorded.** Lane 1: F2–F5 fixed. Lane 2: B–E fixed, and A recorded as a choice for the owner.
- **The full suite green**, at the commit that records this: tsc and knip clean; 5868 passed, 12 expected fail, 5 skipped, 705 files. The 12 expected failures belong to later phases: 6 read repros (phase 4), 4 label repros (phase 5) and S1/S2.
- **A live probe proven to discriminate.** `scripts/probe-realtime.mjs` on the 8505 stack scores the build before phase 3 (976195e0) 0/3 and this build 3/3:
  1. After a daemon restart, a page reopened from its cache is missing the new prompt's row on the old build and shows it on the new one.
  2. Frames dropped on the wire are never asked for again on the old build (0 replay requests) and are repaired on the new one (1). The final text matches on both, because the message end carries the whole reply, so this leg discriminates by the repair, not by the screen.
  3. A message the daemon still queues reads as a plain transcript row after a reconnect refresh on the old build, and stays one "queued" row on the new one.
- **The earlier phases still hold** on this build: `probe-inbox-order` 29/29, `probe-transport` 5/5.

Each fix in the phase came with tests run first against the commit before it, and each commit message names which of them failed there. The only exception is a test that cannot load on the old code because it imports what the fix added; its behaviour is covered by a test at the controller.

The phase 3 known limitations above stand: a send to a session still starting lives in memory only, the page and the snapshot are two reads, and the web answers an unknown API path with the app.
