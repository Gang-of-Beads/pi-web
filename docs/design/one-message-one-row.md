# One message, one row

A message the user sent has been drawn twice, on and off, for months. It has
been fixed at least ten times. Every fix has been a better way of deciding
whether two rows describe the same message; none has changed the fact that the
interface is free to produce two rows in the first place.

This is a design for making the second row **unrepresentable**, rather than
detectable.

## Why it keeps coming back

One user message is rendered from four independent sources.

| # | Source | Where it comes from |
|---|---|---|
| 1 | The optimistic bubble | The browser draws it the moment you press send, so the phone does not look dead while the request is in flight. |
| 2 | The echo | The daemon publishes `message.append` with `echo: true` so a queued prompt is visible before the agent reaches it. |
| 3 | The queued row | The status carries `queuedMessages`, and the browser synthesises a row for any entry it cannot match to a bubble. |
| 4 | The transcript entry | When the prompt finally runs, the real user message lands in the transcript. |

Correctness has always depended on these four **agreeing with each other**. When
they agree, you see one row. When any pair disagrees, you see two. So a
duplicate is not an error state in this design - it is the default outcome, held
off by matching.

Every previous fix improved the matching:

1. match by text
2. …but the runtime expands `/skill` and templates before queueing, so match by
   normalised text
3. …but attachments carry no text, so treat empty text specially
4. …but the queue is listed lane by lane while submissions arrive interleaved,
   so match within a lane
5. …but a delivered prompt leaves its record behind, so drop the surplus

Each step is correct and none of them ends the class. The shape is always the
same: two structures that must mirror each other, reconciled by inference.

## The root

The daemon does not own the queue it reports on.

When a session is busy, the daemon hands the prompt to the **runtime's** queue:

```
session.prompt(text, { streamingBehavior })
```

The runtime stores strings. There is no field for the browser's id, and the
runtime's queue accessors return strings:

```
getSteeringMessages(): string[]
getFollowUpMessages(): string[]
clearQueue(): { steering: string[]; followUp: string[] }
```

So the daemon keeps a **shadow list** of `{ clientMessageId, text }` and tries to
keep it aligned with a queue it cannot see into and does not control. Alignment
is re-derived on every status publish, from position, lane and text.

That is the defect. Not any particular inference - the fact that an inference is
needed at all.

## What the code already proves

The daemon **already owns a queue with identity**. During compaction it parks
prompts itself:

```ts
interface QueuedPrompt {
  kind: QueuedPromptKind;
  text: string;
  images?: ImageContent[];
  echoUserMessage?: boolean;
  clientMessageId?: string;   // ← identity survives, no correlation needed
}
```

On that path there is nothing to correlate: the id is on the entry. Every
duplicate this year has come from the *other* path - the one that delegates
queueing to the runtime and then tries to reconstruct what it gave away.

## The invariant

> **A user message has exactly one row, and that row is keyed by the message's
> identity. Delivery state is a property of the row, not a different row.**

"Sending", "queued", "running" and "settled" are states of one record. Two rows
for one identity must be impossible to construct, not merely avoided.

## Options

### Option A — The daemon owns all queuing (recommended)

Stop using the runtime's queue. When a session is busy, park the prompt in the
daemon's own queue - the one that already exists and already carries the id -
and submit to the runtime one at a time as it drains.

- The daemon always knows what is queued, in what order, with which identity.
- `queuedMessages` becomes a report of owned state, not a reconstruction.
- The shadow list, the correlation function and every rule inside it are
  **deleted**, not improved.

Cost: the daemon takes on ordering and drain responsibility that the runtime
currently handles, including interaction with steer-vs-follow-up semantics and
recall. This is real work and touches the busiest path in the service.

Risk: a bug here stalls delivery rather than duplicating a row. That is a worse
failure mode, so it needs its own tests - but it is a failure mode that says
what it is, instead of quietly drawing two.

### Option B — One keyed collection in the browser

The browser keeps a single map from identity to message record. The optimistic
bubble, the echo, the queued row and the transcript entry all resolve to the
same key and update one record.

- Two rows for one identity are unrepresentable: a `Map` has one value per key.
- Independent of what the daemon does.

Cost: server-originated messages (another browser, the CLI, a subagent) have no
`clientMessageId`, so they need a stable key of their own - the transcript entry
id. Until the transcript entry exists, a message from elsewhere cannot be keyed,
so a short window remains where two sources could disagree.

Risk: it hides the daemon-side ambiguity instead of removing it. The status
would still report a queue the daemon has guessed at, which is wrong in other
ways (recall acting on the wrong entry, for one).

### Option C — Render only server truth

Drop the optimistic bubble. Nothing appears until the daemon confirms.

- Trivially correct: one source, one row.

Cost: on a phone over a slow link, pressing send does nothing visible for as
long as the round trip takes. This is the feedback the optimistic bubble exists
to provide, and removing it is a visible regression for the person who reported
the duplicate in the first place.

## Recommendation

**A, then B.**

A removes the ambiguity at its source and lets a large amount of inference code
be deleted. B then makes the remaining rendering structurally incapable of
producing a second row, including for messages that never had a browser id.

Doing B alone would stop the symptom while leaving the daemon reporting a queue
it has guessed at.

## How it would be enforced

One property-style test at the component level, not at helper level: given any
combination of optimistic bubbles, echoes, queued entries and transcript
entries describing *N* distinct identities, the rendered transcript contains
exactly *N* user rows.

That test fails for every one of the ten historical bugs. The helper tests that
accompanied those fixes did not - they passed while the wire was disconnected,
while ids swapped across lanes, and while a delivered prompt's record was
poisoning its successor.

## What is not in scope

Whether the optimistic bubble should exist at all is a product decision, and
this design assumes it stays. Option C is recorded so the trade is visible, not
because it is proposed.

---

# The same message, swallowed

Reported after the above: a message sent with screenshots, then a refresh, and
the message is simply not there. No error, no trace, nothing to retry. Sometimes
the order is wrong as well.

This is the same fault as the duplicate, one step worse. The duplicate is a
message with two homes. This is a message with none.

## Where a message lives

| Stage | Where it exists | Survives a refresh? | Survives a daemon restart? |
|---|---|---|---|
| Draft, not sent | `promptDraftStorage` in `localStorage` | yes | yes |
| **Sent, waiting** | **the browser's optimistic bubble, and the runtime's in-memory queue** | **no** | **no** |
| Consumed by the agent | the transcript file | yes | yes |

The middle row is the defect. Between pressing send and the agent reaching the
message, it exists only in two volatile places, and both are lost by the two
things that happen most often: the reader refreshes, and the daemon restarts.

The session daemon restarted three times in one evening during ordinary work -
an upgrade, a crash recovery, a service reload. Every queued message at each of
those moments was discarded silently.

## Why it is invisible

A message that vanished and a message that was never sent render identically.
The composer is empty either way, the transcript has no row either way, and
nothing reports a loss. The reader cannot even know to retype it, because they
cannot tell whether it went.

That is the absence-is-not-negation rule broken at the worst possible place: not
a panel showing an empty list, but the user's own words.

## The invariant

> **From the moment the user presses send, the message is durable and
> recoverable until it appears in the transcript. A message can be delayed,
> refused or reported lost, but it cannot silently cease to exist.**

## Design

**A submitted message stays in a durable outbox until the transcript claims
it.**

1. On send, the message moves from the draft store to an **outbox** in the same
   durable storage - text, attachments, lane, and the identity it was minted
   with. It leaves the outbox only when the transcript contains that identity.
2. On load, the browser reads the outbox and renders its entries exactly as the
   register renders anything else: one row per identity, in the `queued` state.
   A message that was in flight when the daemon died reappears, still marked as
   waiting.
3. A message in the outbox whose session cannot account for it - the daemon has
   restarted, its queue is empty, and the transcript does not contain it - is
   **reported as lost with a retry**, not dropped. Absence is stated, not
   guessed at.
4. The daemon's own queue should be recoverable for the same reason, but the
   browser outbox is what makes the guarantee independent of it: the message
   survives even if the machine the daemon runs on went away entirely.

This reuses the register rather than adding a fourth source. The outbox is a
contributor of facts about messages, like the transcript and the queue, and the
register already guarantees one row per identity - so a recovered message cannot
double up with the transcript entry that eventually arrives.

## How it would be enforced

Two tests at the level the failure happens:

- A message submitted, then the page reloaded with an empty daemon queue and no
  transcript entry, appears exactly once and is marked as needing retry.
- A message submitted, then the page reloaded after the agent consumed it,
  appears exactly once, settled, and is not offered for retry.

Both fail today: the message appears zero times.
