# Design — steady-surface-and-visible-actions

## Context

Part of this change is already on disk and is recorded as completed tasks, not re-designed: the
question waiting for the reader holds its own layout row outside the scrolling transcript
(`.waiting-slot`, `233680c8`), the open-card alignment scroll and its press-deferred replay are
gone (`822aaa0f`), an answered dialog leaves instead of parking a card, and suppression of a
settled dialog no longer depends on a Dismiss button (`65b8539d`, `37bcbbb9`).

What remains open, each with its producer identified in the spec deltas:

- The region below the transcript still changes height while a reply streams. Producers measured
  in the code today: the activity dock's label (`renderActivityDock`, ChatView ~1935) whose text
  and elapsed timer grow ("receiving response · 22s" → minutes), the queued strip
  (`.queued-strip`, ChatView ~467) appearing and clearing, and the dock itself mounting only when
  activity exists.
- Slash and shell input bypass the transcript entirely: `sessionController.send` (~line 379)
  routes anything starting with `/` to `runCommand` and returns. A goal button press funnels into
  the same path via `runGoalCommand` (PiWebApp ~2979 → `sendPrompt`), so it leaves no trace, gives
  the panel nothing to show, and reads as a dead button — the owner pressed Resume four times.
- A voided ask renders a bare label: `AskUserCard.renderRecord` maps every non-submitted,
  non-superseded reason to "Cancelled" (AskUserCard ~242), and the client's `ask.closed` handling
  (`applyClosedAsk`, sessionController ~1836) receives no cause at all. The server voids the ask
  in `piSessionService.voidOpenAskForUserMessage` (~1715) knowing exactly why.
- The alignment machinery is half-deleted: the callers are gone but `scrollToOpenAsk`,
  `scrollToOpenDialog`, `alignOpenAskToTop`, `alignOpenDialogToTop`, `deferredOpenAlign` and their
  requestAnimationFrame frames remain in ChatView (~844-846, ~909-915, ~955-961, ~2568-2590,
  ~2704+), unreachable.
- Nobody has ever measured the geometry this change is about. The invariant is currently asserted
  by unit tests on placement, not by numbers at the device the owner actually holds.

## Goals / Non-Goals

Goals (design-level, beyond the proposal's scope):

- One measurement harness that can prove — in the owner's conditions (393×850, coarse pointer,
  8505 stack, real streamed reply) — that nothing under the reader moves, and that can be re-run
  after every producer fix to produce the red→green numbers the owner demands.
- A client-side command lifecycle that makes invisible work visible without touching the daemon
  protocol.

Non-Goals:

- Moving goal control off the chat queue onto a control channel. The owner has not approved that
  semantics change; this design makes the wait honest instead of removing it.
- Server-side command journals or transcript persistence for commands. That is a server data
  format change the owner excluded; the command row is a client projection.
- Redesigning the notification drawer, changing which conditions raise warnings, or rendering
  extension TUI surfaces (separate change: `warnings-belong-in-notifications` is with the owner;
  `ui.custom` bridging is a separate proposal).
- Frame-budget performance work. Jitter here is geometry, not cost.

## Decisions

### D1 — Kill jitter by reserving rows, not by freezing content

Each below-transcript producer gets a persistent row whose height does not depend on its state;
appearance and disappearance toggle *inside* the reserved row.

- **Activity dock**: reserve its row whenever the session is selected and live (connected). The
  label is clipped to one line with ellipsis so text growth ("receiving response" → "running
  tool: …") cannot change height; the timer lives inside the same fixed-height pill. Alternative
  considered: render the dock only while active (today's behaviour) and accept the mount/unmount
  jump — rejected: that jump is exactly the reported jitter, and the reserved row costs a few
  constant pixels for the session's lifetime.
- **Queued strip**: reserve its row while a stream is active or the queue is non-empty; when
  empty mid-stream it renders empty-but-present rather than collapsing. Alternative considered:
  move the strip into the `.waiting-slot` region — rejected: queued messages are transcript
  content (they render in the transcript already), not a question to the reader.
- **Waiting-slot departure**: the slot may appear at any moment (that is the point — the reader
  must see the question), but its *departure* waits for pointerup when a pointer is down, per the
  spec scenario. ChatView already tracks press state for the transcript (`notePressStart` /
  `releasePointer`); the slot defers its removal through the same signal. Alternative considered:
  never animate removal — rejected: the row must leave promptly on ordinary taps; only an
  in-progress press holds it.

### D2 — Command lifecycle is a client-side projection

A `CommandLedger` in `sessionController` records every command send per session
(`{id, text, source: "typed" | "goal-panel", state, issuedAt, resultText}`) with states
`queued → running → ok | failed`. ChatView renders ledger entries as transcript rows in the
established queued-message visual language (gold), placed after pending messages.

- `queued → running`: the ledger marks `queued` when the session is streaming (status already
  exposes it) or the send is parked by `enqueuePendingSessionSend`; `running` when the daemon
  accepts it (send resolves) — for typed commands `runCommand` already awaits the daemon call.
- `→ ok | failed`: the awaited command result settles the row. Failure text comes from the error
  the send path already surfaces.
- **Reconciliation**: when the server's own record of the command arrives in the transcript (the
  daemon echoes command effects), the ledger row is retired, not duplicated — match on command
  text within the session, retire the client row, keep the server's copy as canonical. Alternative
  considered: suppress the client row once the server copy exists and never render both — rejected
  for v1 complexity; a brief overlap during reconcile is honest and harmless, duplication is not.
- **No daemon change**: the row is labelled as the browser's own record. If the owner later wants
  commands in the durable transcript, that is a server proposal, not this one.

### D3 — Goal buttons acknowledge through the ledger, plus a pressed state

`runGoalCommand` keeps routing through `sendPrompt` (D2 makes that visible) and additionally:
the pressed control enters a pressed/in-flight state immediately (disabled while its command is
in flight, so a double press cannot start a second copy), and the panel's post-command refresh
stays where it is (after the await) so the panel never redrews "unchanged" as if the press were
lost. The transcript row carries the waiting/running/result story; the button carries the
instantaneous "heard you".

### D4 — The void reason travels as a new additive field, not a new reason value

`AskUserOutcome` gains an optional `cause: "user-message" | "withdrawn" | "timeout"` set by the
server's void paths (`voidOpenAskForUserMessage` → `user-message`; producer-withdraw and timeout
paths map to their own causes). The client renders: "You sent a message instead of answering",
"Withdrawn before an answer", and falls back to today's "Cancelled" when `cause` is absent (older
daemon) — absence rendered honestly, per the house rule. Alternative considered: overloading
`reason` — rejected: `reason` is the outcome kind (submitted/superseded/cancelled) that existing
switches and persisted outcomes already depend on; conflating who/why into it breaks them. This
is an additive server field, within the owner's approved boundary.

### D5 — Delete the dead alignment machinery completely

Remove `scrollToOpenAsk`, `scrollToOpenDialog`, `alignOpenAskToTop`, `alignOpenDialogToTop`,
`deferredOpenAlign`, the two rAF frame fields, their cancellation branches in the
disconnect/visibility paths, and the deferred-replay block. A grep gate in the task proves no
reference survives. Half-deleted machinery is how this repo accumulates ghosts; the deletion is
its own commit so the grep evidence is unambiguous.

### D6 — Measurement harness: a probe script, not shipped code

`scripts/probe-waiting-stability.mjs`, following the existing probe convention
(`probe-dialog-flow-hit-testing.mjs`): drives the 8505 stack at 393×850 with a coarse pointer,
opens a session, opens a pending dialog, starts a streamed reply, and samples at 100 ms:
`getBoundingClientRect()` of the waiting controls, the composer top edge, and the dock/strip
heights; plus `document.elementFromPoint` at touchstart vs the click target for the tap-twice
invariant. It FAILS unless the preconditions hold (question rendered, stream actually streaming,
viewport actually 393×850) — a probe that silently tests nothing is worse than no probe. The
baseline run is expected RED (numbers > 0), and the same script is the green gate after tasks 3.x.
Numbers are pasted into the task checkboxes, not paraphrased.

## Risks / Trade-offs

- [Reserved rows read as phantom gaps when empty] → Rows reserve only under D1's trigger
  conditions (live session / active stream); an idle or archived session keeps the compact
  layout. Session switch may change layout — that is navigation, not movement under a pressed
  pointer.
- [Client command rows could disagree with the daemon about what happened] → The row is labelled
  as the browser's record; reconcile retires it in favour of the server copy; failure text is the
  send path's own error, not an invention.
- [`cause` absent from older daemons] → Client falls back to "Cancelled"; no crash, no invented
  cause. The field is additive so old clients ignore it too.
- [Probe flakiness under machine load] → Run against the dedicated 8505 stack; the probe asserts
  its own preconditions and fails loudly rather than passing vacuously; a red run is re-run once
  and both results recorded.
- [Deferring slot departure could look like a stuck card] → The hold is bounded to an in-progress
  pointer; `pointercancel` releases it like `pointerup`.

## Migration Plan

Client-first, additive server field last, each independently committable and revertible:

1. Dead-code deletion and the measurement harness (no behaviour change).
2. Below-transcript reservation (behaviour change, guarded by the probe).
3. Command ledger + goal acknowledgment (new client state only).
4. `cause` field (additive server change; client falls back gracefully).

Rollback is `git revert` per step; no persisted state, no protocol break, no data migration.

## Open Questions

None that would change the specs, the approach, or the task breakdown. The goal-control-channel
question is a recorded non-goal awaiting an owner decision; the `ui.custom` bridge is a separate
future proposal. Both are out of scope here by the owner's instruction.
