# Message sync over a network that loses things

A design for delivering a message from a phone to an agent and back, when the
link is slow, lossy, or gone, and when either end can restart mid-flight.

It exists because the current arrangement has produced, repeatedly: the same
message drawn twice, a message drawn nowhere, a message stuck marked "Queued"
while later ones were answered, and a panel that says "Loading" with nothing in
flight. Those are four symptoms of one absence — there is no delivery protocol,
only three components each guessing what the others meant.

## What the field already knows

Established results worth not rediscovering:

- **Exactly-once delivery is impossible** over an unreliable link (two generals).
  What is achievable is **at-least-once delivery plus idempotent processing**,
  which is indistinguishable from exactly-once at the point where it matters:
  what the user sees.
- **The idempotency key is the whole trick.** The sender mints a stable id
  before the first attempt and reuses it for every retry; the receiver records
  what it did for that id and replays the answer instead of redoing the work.
  Stripe keeps such keys for 24 hours.
- **The outbox pattern** makes a submission durable at the sender before it is
  ever attempted, so a crash between "user pressed send" and "server accepted"
  loses nothing.
- **Sequence numbers and acknowledgements** at the application layer, not TCP's:
  the receiver reports the last sequence it holds, the sender replays from
  there. `readyState === OPEN` is not evidence that anything arrived.
- **Optimistic UI is reconciled, not merged.** The local row and the server's
  row are the same row, identified by the sender's id, never by their contents.

None of this is exotic. All of it is missing here.

## What is actually wrong now

Established by reading the code, with file and line.

### A message has no durable home between send and delivery

`PromptEditor.resetComposer` clears the draft and the attachment list at
submission time (`PromptEditor.ts:1068-1069`, `:1115-1119`), and the optimistic
row lives only in `appState.messages`. The daemon holds queued prompts in
process memory (`piSessionService.ts:1177`, and the runtime's own
`steeringQueue`/`followUpQueue` arrays). The message reaches disk only when the
runtime takes it into a turn.

So between pressing send and the agent starting, the message exists in two
volatile places and nowhere else. A refresh loses one, a daemon restart loses
the other, and this session's daemon restarted three times in one evening.

The recovery path that exists is written **inside the catch of a settled failed
request** (`PromptEditor.ts:1100-1105`). A page unload settles nothing, so no
catch runs. Nothing anywhere records that a message existed.

### The queue's identity is reconstructed, not carried

The runtime queue stores strings. The daemon keeps a shadow list and re-derives
which browser message each entry belongs to on every status publish. Records are
removed on recall and on clear-queue, and **never on delivery, run end, abort or
timeout**. Consequences, all proven:

- a record whose prompt was delivered stays and is handed to the next entry, so
  an old bubble reads "Queued" forever while newer messages are answered;
- records written by the compaction drain carry no lane
  (`piSessionService.ts:4159`), and a lane-less record is treated as a wildcard
  and is never pruned by count (`queuedPromptIdentity.ts:47`, `:80-84`);
- a status published while the queue is momentarily empty deletes every record
  still owed an id (`piSessionService.ts:2663-2665`), and `publishStatus` fires
  on every runtime event.

### "Queued" is four different facts wearing one badge

| What the user sees | What actually drives it |
|---|---|
| Gold bubble and Recall | live `status.queuedMessages`, matched by id |
| The word "Queued" | `line.meta.delivery.state`, a client-side machine |
| Row in the pending block | register state ≠ settled |
| Row in the transcript | register default |

They are not the same fact and they disagree routinely. A message can sit in the
transcript still saying "Queued", or sit in the queue with no gold and no
Recall.

### Order is not defined anywhere

The status lists all steers then all follow-ups
(`piSessionService.ts:5241-5250`), so a follow-up sent first appears below a
steer sent second. `placeByTimestamp` always appends user lines, so a prompt
drained late lands after messages sent after it.

### Absence is rendered as progress

`goalsForSelectedWorkspace` returns `unloaded` whenever the slot answers for a
different selection (`appState.ts:286-291`), and `GoalPanel.isReading` treats
`unloaded` and `loading` identically (`GoalPanel.ts:109-111`), so **"not
loaded" renders as "Loading goals…" forever**. The refresh button is disabled in
exactly that state (`GoalPanel.ts:73-77`), and the drawer that shows it passes
no refresh handler at all (`ChatView.ts:1452-1459`). The state is unrecoverable
from the interface.

## The design

### One lifecycle, one owner per transition

A message is a record with an identity and exactly one state. The identity is
minted by the browser before the first attempt and never changes.

```
composed ──send──▶ outbox ──accepted──▶ queued ──taken──▶ running ──▶ settled
                      │                    │
                      └──refused──▶ failed ┴──recalled──▶ withdrawn
```

Rules that make the states honest:

- **`outbox`** is durable at the sender. A message enters it *before* the first
  request and leaves it only when the transcript shows its identity. A reload
  during upload finds it there.
- **`accepted`** requires the daemon's answer, not the absence of an error.
- **`queued` and `running` are reported by the daemon**, never inferred by the
  browser from a timeout.
- **`failed` is a verdict**, only reachable from a definite refusal. A request
  that timed out is not a refusal: the daemon may have accepted it. That
  distinction is currently collapsed, and collapsing it produces the composer
  restoring the text *and* the daemon queueing the message — one message, two
  places, again.
- **`settled`** is the transcript, and it is the only terminal state that
  removes anything from the outbox.
- **`withdrawn`** is the second terminal state: the reader took the message
  back. It is reached only by a confirmed recall - this device's, or a
  withdrawal frame carrying the `clientMessageId` from the daemon (another
  browser's recall, stop, or queue clear must publish one, or this device's
  bubble stays `queued` forever, because the transcript will never claim a
  message the daemon deleted). A withdrawn entry is never offered a retry:
  re-sending what the reader explicitly recalled is the one failure step 8's
  "unconfirmed with a retry" must not be able to produce.

### The daemon owns the queue it reports

Stop delegating to the runtime's queue and stop reconstructing what was handed
away. Park prompts in the daemon's own structure — which already exists and
already carries the identity (`QueuedPrompt` has `clientMessageId`) — and submit
one at a time. Then:

- the reported queue is owned state, not a guess;
- delivery removes the entry, so nothing can outlive its prompt;
- lanes are explicit rather than reconstructed from list position;
- recall acts on an identity instead of a text match.

The correlation module and every rule inside it are deleted, not improved.

**Held → submitted is decided once, at the runtime-call boundary.** Whether a
parked prompt queues is a property of the runtime's state *when it is handed
over*, not when it arrived: a follow-up parked long ago and handed to a runtime
that has gone idle goes out as a direct send, because an idle runtime has no
turn-end left to drain it. One pure classifier makes the decision
(`promptDeliveryBehavior`); `session.prompt` is the single throat where it
applies, so an un-redecided handoff is not representable - a direct call is a
documented exception, not a second path. Two consequences are part of the
rule, not incidental:

- **steer is not parked.** A steer means "insert into the turn in progress":
  busy, it is delivered immediately as a steer; idle, it is just a prompt. A
  daemon queue that submits a steer in order has already destroyed it.
- **drain has a liveness rule, not only a trigger.** The named trigger is the
  runtime's settled event; the rule that makes a missed event self-heal is:
  queue non-empty ∧ runtime idle → drain. Without it, one lost turn-end during
  a restart parks a follow-up in the daemon's own queue forever - silently,
  which is the exact shape this design exists to end.

### At-least-once, made idempotent by the id

The browser retries from the outbox with the same identity. The daemon keeps a
short-lived record of identities it has accepted and answers a repeat with the
same result rather than queueing a second copy. This is the standard
idempotency-key contract, and it is what makes retrying safe enough to do
automatically.

The ledger records the disposition of **every accepted prompt, on every path**
- a direct send accepted while the runtime was idle leaves a record too, not
only prompts that arrived while busy. Its lifetime is coextensive with the
owned queue's: same volatility, same restart semantics, because a daemon
restart between acceptance and transcript claim hands a retry a cold ledger.
The test that pins the contract: a direct-path prompt is accepted, the response
is lost, the browser retries with the same id - the message runs exactly once.

### Resume by sequence, not by hope

The event stream already has sequence numbers and a replay ring. The rule to
hold: on reconnect the browser reports the last sequence it holds and the daemon
replays from there or says plainly that it cannot. A gap that cannot be filled
is reported to the reader; it is not left to look like quiet.

### Every wait has a deadline, and a deadline is not a verdict

No request may hang forever. A request that exceeds its budget reports that the
server did not answer **within the budget** - which is a different statement
from "the server refused", and must not remove the optimistic row. Uploads get a
larger budget than reads, because slow and never have to stay distinguishable.

## What this buys, per symptom

| Symptom | What removes it |
|---|---|
| Message drawn twice | one register keyed by identity; nothing reconstructs identity from text |
| Message disappears | durable outbox, entered before the first attempt |
| Stuck "Queued" | daemon owns the queue; delivery removes the entry |
| Wrong order | a single ordered queue with explicit lanes, and transcript placement by the daemon's sequence |
| "Loading" forever | unloaded and loading are different states, and every request settles |

## What has to be measured, not assumed

- The prompt POST carries base64 screenshots in a JSON body, so it currently
  receives the short read budget rather than the upload budget
  (`requestDeadline.ts:16`). The real distribution of upload sizes and times on
  a phone link decides that number; it should not be guessed.
- Whether the daemon can accept a prompt after the client has given up is the
  race that turns a timeout into a duplicate. It needs a test, not an argument.

---

# The concrete shape

## The record

One structure, held in the browser's durable store and mirrored by nothing.

```ts
interface OutboxEntry {
  /** Minted once, before the first attempt. Never derived from content. */
  id: string;
  sessionKey: string;        // machine + session; an entry belongs to one
  lane: "steer" | "followUp";
  text: string;
  attachments: SavedPromptAttachment[];
  state: "outbox" | "accepted" | "queued" | "running" | "failed" | "withdrawn";
  attempts: number;
  firstSubmittedAt: string;
  lastError?: { kind: "refused" | "unanswered"; message: string };
}
```

`settled` is not a state here: a settled message has left the outbox, because
the transcript now holds it. Keeping a settled copy is how two rows get built.

## Who may move it

| Transition | Only this may cause it |
|---|---|
| composed → outbox | the composer, before any request |
| outbox → accepted | the daemon's 2xx answer to the submission |
| accepted → queued / running | the daemon's status, by id |
| any → failed | an explicit refusal (4xx), never a timeout |
| any → withdrawn | a confirmed recall: this device's, or a daemon withdrawal frame carrying the id |
| any → gone | the identity appearing in the transcript |

A timeout moves nothing. It records `lastError.kind = "unanswered"` and leaves
the entry where it is, because the daemon may have accepted it. Treating an
unanswered request as a refusal is what produces a restored composer *and* a
queued message - the same message in two places, which is the bug this whole
design exists to end.

## The daemon side

```ts
interface OwnedQueueEntry {
  clientMessageId: string;   // the sender's id, carried, never re-derived
  lane: "steer" | "followUp";
  text: string;
  images: ImageContent[];
  acceptedAt: string;
}
```

The daemon holds the queue itself and submits one entry at a time to the
runtime. It never asks the runtime what is queued, because it already knows.

An **acceptance ledger** keyed by `clientMessageId` records what was done with
each identity for a bounded window. A repeat submission with a known id returns
the original outcome instead of queueing a second copy. That is what makes the
browser's automatic retry safe.

## The protocol, in order

1. Composer writes the entry to the outbox. Draft and attachments are **not**
   cleared yet.
2. Submission is attempted with the entry's id.
3. **2xx** → state `accepted`, composer cleared, attachments released.
4. **4xx** → state `failed` with the server's reason, composer restored.
5. **No answer within the budget** → nothing moves; retry with the same id,
   backing off. The reader is told it is unconfirmed, not that it failed.
6. Daemon status reports `queued`/`running` by id; the entry follows.
7. The identity appears in the transcript → entry leaves the outbox.
8. On load, every outbox entry is rendered through the register, in its own
   state. An entry the daemon cannot account for - not queued, not running, not
   in the transcript - is shown as **unconfirmed with a retry**, never dropped.

## Migration, in landable pieces

Each step is separately shippable and separately verifiable. No step depends on
a later one being finished.

1. **Every request settles.** Deadlines, and an `unanswered` outcome that is
   distinct from a refusal. (Largely written; the refusal/unanswered distinction
   is not.)
2. **The register becomes the only renderer.** One row per identity. (Written
   and wired; not shipped.)
3. **The outbox becomes durable**, entered before the first attempt, rendered
   through the register on load. Removes the disappearing message.
4. **The daemon owns the queue.** Removes correlation entirely, and with it the
   stuck "Queued", the cross-lane swap and the delivered-record drift.
5. **The acceptance ledger** makes retry safe, which makes step 3's retry
   automatic rather than manual.
6. **Ordering becomes explicit**: one ordered queue with lanes as a field, and
   transcript placement by the daemon's sequence rather than by arrival.

Steps 1-3 are browser-side and cannot break a session. Step 4 touches the
busiest path in the daemon and is the one that needs the most care: its failure
mode is a stall, not a duplicate.

## Failure modes of this design, stated plainly

- **Step 4 stalls delivery** if the daemon's drain has a bug. A stall is louder
  than a duplicate but stops work entirely. It needs its own tests: a queue that
  drains under interruption, abort, recall and compaction.
- **The outbox can grow** if entries are never claimed - a session deleted on
  the machine, for instance. Entries need an age at which they are presented for
  disposal rather than retried forever.
- **Two browsers on one session** both hold outboxes. Their ids differ, so they
  cannot collide, but each will show the other's message only once it reaches
  the transcript. That is correct and worth stating.
- **The acceptance ledger is bounded**, so a retry after the window queues a
  second copy. The window must exceed the longest plausible offline gap for a
  phone, and the outbox should stop retrying before then.

## How it is enforced

Property tests at the level the failures happen, not at helper level - the
helpers were green through every one of the ten historical duplicates.

1. **One row per identity**, over any mix of transcript, outbox and daemon
   queue. Already written.
2. **A submitted message survives a reload** in every state, and appears exactly
   once afterwards.
3. **An unanswered submission never removes the optimistic row**, and a retry
   with the same id produces one message on the daemon, not two.
4. **The queue drains in submission order within a lane**, under interruption,
   abort and compaction.
5. **No loading flag outlives its request**: for every panel, a request that
   never answers ends in a reported failure, not a permanent "Loading".


---

# The consolidated state machine (implementation contract, 2026-09-04)

Commissioned after the thirteenth duplicate: one machine, both ends, one
vocabulary. Anything a surface renders about a message MUST be derived from
these states; a word with no state here is a bug.

## States and their owners

| State | Owner | UI word | Card |
|---|---|---|---|
| `composing` | composer | (draft) | - |
| `outbox` | browser store, written BEFORE the first attempt | `Unsent` + Retry/Discard | strip above composer |
| `sending` | browser, request in flight | `Sending` | orange, receipt |
| `accepted`/`queued` | daemon (ledger + owned queue) | `Queued - N` | **yellow, the only queued face** |
| `running` | runtime | (turn is visibly running) | - |
| `settled` | transcript (identity claimed) | `Read` | orange, receipt |
| `withdrawn` | daemon frame / local recall | (row gone) | - |
| `failed` | explicit refusal only | `Not sent` | orange, receipt |

## Transition rules

- `outbox -> sending -> accepted` on the daemon's 2xx; a timeout moves
  nothing; `accepted` without a frame heals by idempotent retry (ledger).
- `queued -> settled` by identity claim, and by level trigger: absent from the
  queue of an idle runtime = consumed. Re-derived on every status.
- `sending` heals the same way: on load and reconnect the outbox flushes with
  the same id; the ledger makes the retry safe. A sending row can therefore
  wait, retry, or fail - never sit forever.
- One row per identity is enforced at the transcript write point; producers
  cannot append a second copy of the same id.

## Ordering

User rows render in daemon acceptance order. Unacknowledged rows (`sending`,
`outbox`) are by definition the newest sends and render after every
acknowledged row - a `Sending` row above a yellow `Queued` card is a state
machine violation, not a styling choice. Placement by daemon sequence lands
with migration step 6.

## Representation law

One state, one word, one card. The yellow card is the only queued face; an
orange card can say `Sending`, `Sent`, `Read` or `Not sent` and never any
queued word. Enforced: the queued classifier drives colour and words from one
fact, and the lane-variant string is deleted.
