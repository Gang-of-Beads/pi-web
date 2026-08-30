# chat/state-consistency Specification

## Purpose
The guarantee that a session view shows what the server holds: sequence on every
frame that carries state, gap detection in the client, a bounded repair when a
gap is found, and honest signalling while repair happens or fails. This is the
transport contract underneath the panel, geometry, and warning changes.

## Requirements

### Requirement: Every state-carrying frame is ordered and detectable

Every frame that carries session state to the browser SHALL carry a monotonically
increasing sequence number for its scope, such that the client can tell whether
it has missed a frame. A frame whose absence the client cannot detect SHALL NOT
be the only carrier of state the reader acts on.

Scopes today, from the investigation: per-session frames (transcript, status,
activity, asks, dialogs, inbox deltas) are stamped by the hub; global frames
(cross-session status and activity, unread, notification summaries) are not.

#### Scenario: A gap is recognisable

- **WHEN** frames for a scope arrive with sequence numbers n and n+2
- **THEN** the client SHALL be able to determine that the frame carrying n+1 was
  never applied, without guessing from timeouts

#### Scenario: A malformed frame is not silently swallowed

- **WHEN** a frame arrives that fails validation
- **THEN** the client SHALL treat it as a gap in the sequence and enter the
  repair path, rather than dropping it and continuing as if nothing was missed

### Requirement: A detected gap is repaired from the server

When the client detects a gap in a scope, it SHALL resynchronize that scope from
the server and then resume applying live frames, so that the view converges on
the server's state. Repair SHALL be bounded in time, SHALL NOT duplicate content
already shown, and SHALL NOT require the reader to reload the page.

Two repair shapes are admissible, to be chosen per surface by the design: replay
of the missed frames from a cursor the client supplies, or a full resync of the
scope modelled on the notification inbox's revision check. A repair that cannot
complete SHALL be reported to the reader in the surface it affects, following
the honesty rules of the panel states.

#### Scenario: A lost transcript frame mid-stream

- **WHEN** a transcript frame is missed while a reply is streaming
- **THEN** the client SHALL repair the transcript to the server's content and
  continue the stream without a page reload, without duplicating messages

#### Scenario: Repair cannot complete

- **WHEN** the resync or replay fails repeatedly
- **THEN** the affected surface SHALL say its view is stale rather than
  presenting the old content as current

### Requirement: Reconnection converges without a manual reload

After any connection loss and reconnection, the session view SHALL converge on
the server's state without the reader reloading the page. Recovery SHALL NOT
depend solely on a silence timeout; loss that occurs while keepalives continue
SHALL still be detected by sequence.

#### Scenario: The socket dies silently and comes back

- **WHEN** the connection is lost without a close frame and later re-establishes
- **THEN** the view SHALL show the server's current state and the reader SHALL
  NOT need to reload to see messages produced during the outage

#### Scenario: The count and the content agree

- **WHEN** a notification arrives, is read, or is dismissed
- **THEN** the drawer's count and the drawer's list SHALL be derived from one
  sequenced source, and a summary that cannot be reconciled SHALL trigger the
  same repair as any other gap rather than leaving the two in disagreement

### Requirement: Polling is a fallback, not the mechanism

A periodic poll SHALL exist only where the evented path cannot carry the data.
Each poll that exists solely to compensate for undetected frame loss SHALL be
removed once its surface is sequenced, and every remaining poll SHALL name, in
its own code, the surface it backs up and the event that replaces it.

#### Scenario: The delivery reconcile retires

- **WHEN** prompt delivery status is carried by sequenced frames with repair
- **THEN** the timed reconcile that exists to catch its losses SHALL be removed

#### Scenario: The activity poll names its reason

- **WHEN** a periodic poll remains in the code
- **THEN** its constant or its setup SHALL state which surface it backs up, so
  the next reader can tell compensation from design

### Requirement: A message renders in final order only at a confirmed position

Every entry a user sends SHALL be in exactly one of these states, and the state
SHALL determine where it may render. The owner has observed a popped queue
message appear above the previous reply and then reorder itself; his ruling is
the rule: **the settled transcript does not change order after the fact - an
entry joins it only once its position is confirmed by the server.**

The states, exhaustively:

1. **composed** - text in the composer. Renders only in the composer.
2. **sending** - the send request is in flight, unacknowledged. Renders as the
   composer's sending indicator, not in the transcript.
3. **queued-client** - accepted by this browser while the session was busy,
   not yet acknowledged by the daemon. Renders only in the marked queued area
   below the settled transcript, visibly provisional (the gold treatment).
4. **queued-server** - the daemon acknowledges holding it. Still renders in
   the queued area; a queue position is not a transcript position.
5. **committed** - the daemon has taken it into a turn and assigned its place
   in the transcript. Only now may it join the settled transcript, at exactly
   that place, where it SHALL then remain.
6. **failed** - the send or delivery failed. Renders as a failure with the
   text recoverable; it SHALL NOT silently disappear from the queued area.

#### Scenario: A queue pop does not straddle the reply

- **WHEN** a queued message is delivered while a reply is streaming or just
  settled
- **THEN** the message SHALL NOT appear above that reply and later move; it
  SHALL stay in the queued area until its committed position is known and then
  appear there once, in final order

#### Scenario: Settled content never reorders

- **WHEN** any entry has rendered in the settled transcript
- **THEN** no later frame, reconnect, or repair SHALL change its position
  relative to other settled entries; a repair that disagrees SHALL be treated
  as a gap and resolved before rendering, not after

#### Scenario: Uncertainty is visible, not guessed

- **WHEN** the client does not yet know an entry's final position
- **THEN** the entry SHALL render in the visibly provisional area rather than
  being placed into the settled transcript at a guessed position
