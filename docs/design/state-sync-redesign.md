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
