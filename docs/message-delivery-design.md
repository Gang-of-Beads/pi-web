# Message delivery: states, consistency, ordering

What happens to a message between the moment someone hits send and the moment
the agent reads it, and what the product owes them at each step.

This exists because three releases in one afternoon (1.202608.5, .6, .7) each
broke this path in a different way, and every one of those breaks traces to the
same root cause: the states were implicit, so each change reasoned about a
different subset of them.

## The states

A message this browser sent carries a correlation id (`clientMessageId`) minted
before the request leaves. That id is what makes the states observable rather
than guessed.

| State | Truth | The message is | What the user is owed |
|---|---|---|---|
| `composing` | browser only | still in the composer | free editing; nothing is at stake yet |
| `sending` | browser only | in flight, unacknowledged | visible immediately, marked as unconfirmed |
| `failed` | browser only | never reached the server | the text back, editable, plus a way to retry |
| `received` | server | accepted, agent idle, submitted straight through | a single mark; nothing to take back |
| `queued` | server | held in a lane (steer / follow-up), agent has not read it | a recall action, and its place in the order |
| `read` | server + transcript | consumed into the conversation | nothing - it is history now |
| `recalled` | server | removed from the queue at the sender's request | the text and its attachments in the composer |
| `dropped` | server | removed by an abort or a queue clear | the same as `recalled`: nothing may vanish silently |

`recalled` and `dropped` are the same transition with different triggers, and
that is deliberate: a stop button that discards pending work is a data-loss bug
wearing a feature's clothes.

## Authority: the server is the only truth

Every state above except the first three belongs to the server. The browser
keeps a projection with an optimistic prefix, and the projection obeys two
rules.

**Monotonic advance.** `markDelivery` never moves a message backwards. A status
that arrives after the queue drained must not pull a `read` message back to
`queued`, and a slow HTTP response must not undo what the event stream already
reported.

**No client-only disappearance.** A message may never be hidden on the strength
of browser state alone. 1.202608.5 hid queued messages using the bubble's own
delivery state; when that state went stale the message was in neither the
transcript nor the queue panel, and only a reload brought it back. The
acceptable failure is a duplicate for one frame, never an absence.

Reconciliation points, in order of authority:

1. the transcript page (`GET /messages`) - rebuilt from disk, no client state,
2. `status.queuedMessages` - the queue as the server sees it right now,
3. the stream snapshot on reconnect, with `seq` as the watermark,
4. live events, which are deltas and are only trusted between reconciliations.

## Ordering

The runtime holds two FIFO lanes, `steering` and `followUp`, and drains
steering first. Order within a lane is arrival order. Two things can disturb
that, and both are ours to prevent.

**Recall is clear-and-replay.** The runtime offers only `clearQueue()` -
"clear all queued messages and return them" - so removing one entry means
emptying the queue and putting the survivors back. The replay must preserve
each lane's order and must not move a message between lanes. It also has to
bypass the duplicate suppression in `prompt()`, which would otherwise see each
restored message as a double-send and drop it.

**Recall must not race a new message.** While a recall is replaying, the queue
is empty, so a prompt landing in that window is either overtaken by messages
queued minutes earlier or lost behind them.

`runSessionEntryMutation` looks like the answer and is not: it is a reference
count that feeds the activity label, and nothing ever waits on it. Wrapping a
recall in it buys no exclusion at all - a review caught this claim in an earlier
draft of this document, and the code that trusted it.

The rewrite therefore takes a real per-session lock (`withQueueLock`), which is
deliberately narrow. It must never be held across `session.prompt()` for a fresh
submission, because that promise resolves when the *turn* ends: a lock around it
would block every later queue operation for minutes. It protects the rewrite
window itself.

**Recall must not remove the wrong copy.** `clientMessageId` is optional - other
clients and older ones never mint one - and the runtime keys its queue on text,
so two identical queued texts are indistinguishable. Removing the first
occurrence keeps the visible order stable, and the response carries the queue
the server ended up with, so the UI re-renders from truth rather than from its
own guess.

## Duality

Every forward transition has an inverse or an explicit terminal. Where there is
no inverse, that has to be visible in the UI rather than discovered.

| Forward | Inverse | Notes |
|---|---|---|
| compose → send | `failed` → text returns to composer | the request never landed; retry is safe |
| send → queue | recall | lossless: text *and* attachments must come back |
| queue → queue (reorder) | none | order is arrival order; nothing reorders it |
| queue → read | none | an unsend does not exist; only fork or rewind |
| queue → dropped (abort, clear) | none today | **gap**: content is discarded silently |

## Known gaps

Ordered by how much a user loses when they hit them.

1. **Abort discards the queue.** `abort()` clears both queues and returns
   nothing, so pressing stop destroys pending messages, attachments included.
   It should behave as recall-all: hand the content back to the composer.
2. **A recalled message returns as text.** Images ride on the prompt options and
   the queue projection is text-only, so the message that comes back to the
   composer comes back without its attachments. The *survivors* no longer lose
   theirs - the server remembers the images a queued prompt carried and restores
   them on replay - but the recalled message itself still needs an outbox in the
   sender's browser to come back whole.
3. **The queue has no revision.** `status.queuedMessages` is a bare array, so a
   client cannot tell a stale queue from a current one, and recall cannot be a
   compare-and-swap. A monotonic `queueRevision` on the status would let recall
   be rejected when the queue moved underneath it, and let a browser detect a
   missed update instead of waiting for the next full status.
4. **A recall that loses the race is reported, not hidden.** The agent can read
   a message between the click and the request landing. The response says
   whether anything was actually taken back, and the client only removes the
   bubble when it was: assuming success deleted a message the conversation
   already contained and offered its text for a second send.

## Why the marks are worded the way they are

The glyph carries the state at a glance and the words carry it for anyone who
cannot tell one tick from two. Both are needed; neither is decoration.
`Queued to steer` says which lane, because that is the difference between "the
agent will read this next" and "the agent will read this after the turn".
