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
