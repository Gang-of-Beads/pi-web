# A message's own state, and the scope it belongs to

Design for review. The owner's report, verbatim: send a message in session A, switch to
session B's chat, then A's send fails - and the resend/discard row shows up in session B.
Also: enumerate every message state once, drive it with a state machine keyed by a property
on the message (not if/else ladders), and keep concurrent writers from dirty-reading each
other.

Nothing ships until this is agreed.

## What actually happens today

`PromptEditor.deliverAndRestoreOnFailure` captures the correct key at send time
(`machineSessionKey(machineId, sessionId)`, PromptEditor.ts:1208) and the outbox *storage*
is per key (`pendingOutbox.ts:36`). The leak is one line further on: every path ends with
`this.pendingPrompts = loadPendingPrompts(outboxKey)` - an assignment to the *editor's*
state, using the key captured at send time, while the editor is now rendering another
session. The list the reader sees is therefore "the last send's session", not "the session
on screen". The composer-restore path has the same shape and says so in its own comment
(PromptEditor.ts:1244).

So the defect is not a missing key. It is that **the list is component state rather than a
selection over the messages the scope owns**, so any late async completion can win.

## The model

A message the browser sends is one record, owned by one scope, in exactly one state.

```ts
type MessageScope = { machineId: string; sessionId: string; cwd: string };

type OutgoingState =
  | { kind: "stored" }                    // in the outbox, not yet handed to the transport
  | { kind: "sending" }                   // handed over, no answer yet
  | { kind: "accepted"; queued: true }    // the daemon owns it (queued|received)
  | { kind: "delivered" }                 // the daemon says delivered, or it is in the transcript
  | { kind: "unverified" }                // sent, answer lost; not proof either way
  | { kind: "failed"; retryable: boolean }; // retryable: keep the row; else restore/discard

type OutgoingRecord = { scope: MessageScope; clientMessageId: string; text: string; state: OutgoingState; ... };
```

Every record carries its scope. Nothing renders a record whose scope key is not the current
one; nothing writes a record it does not own.

### Transitions (one pure table)

| state | event | next | guard |
|---|---|---|---|
| stored | send accepted | sending | — |
| stored | send rejected | failed(retryable) | the failure is a network fault |
| stored | send rejected permanently | failed(false) | a 4xx that a retry cannot fix |
| sending | transport accepted | accepted | — |
| sending | transport refused | failed(retryable) | id not yet seen by the daemon |
| sending | timeout | unverified | id not seen by the daemon |
| accepted | daemon reports queued/received | accepted | — |
| accepted | daemon reports delivered | delivered | — |
| accepted | transcript already carries the id | delivered | — |
| unverified | transcript carries the id | delivered | — |
| unverified | daemon reports it queued | accepted | reconcile on reconnect |
| any | session no longer exists | dropped | — |
| failed | retry | sending | same record, same clientMessageId |
| failed | discard | dropped | — |

The table is one function `outgoingTransition(state, event) -> state | "ignore"`, with the
cross-product enumerable in tests, so an unhandled event fails there instead of in a
renderer.

### Rendering is a selection, not state

`pendingRows(currentScopeKey)` returns the records whose scope matches, in send order. The
editor no longer holds `pendingPrompts` as a value that async work assigns; it re-derives
from the store on a version counter, so a completion for session A cannot change what
session B shows.

The row's appearance is a table too: state -> "bubble mark", "row action", "composer
restore". A failed-and-retryable row offers retry/discard; a delivered row disappears; an
unverified row says so and offers nothing that would double-send.

### Concurrency

- One writer per record: the record is keyed by `clientMessageId`, and every write goes
  through `apply(id, event)`, which is a no-op if the record is gone.
- A transport answer is applied to its own record's scope, never to "the current session".
- The composer restore on a permanent failure applies only when the current scope equals the
  record's scope; otherwise the text stays in that session's outbox for when the reader
  returns.
- Reconnect reconciliation is a single pass over `unverified` records, one probe each, and
  it is idempotent (the same answer twice is the same state).

## The top strip's membership

Only surfaces where "is it running" is the question:

- subagents (a child is running) - already opted in.
- background tasks (a command is running).
- goals (the focused goal is being driven).

`git` and `files` stay in the navigation menu: a branch and a folder have a *content* state,
not an activity state, which is why a pulsing git chip read as noise.

## Work order

1. The scope fix alone, with the transition table for `stored/sending/failed` - it is the
   live defect.
2. `unverified` + reconnect reconciliation folded into the same table.
3. Row rendering table; delete `pendingPrompts` as assigned state.
4. `topEntry` on background-runs and goals.

No release until the design is agreed.
