## Why

The owner asks whether the app keeps the browser's view strictly consistent with
the server's, or drifts and paper over the drift with periodic refresh, which he
calls slow and imprecise. The investigation (file:line evidence below) answers
him: the transcript has a sequence watermark, but it is consumed only at join;
mid-stream there is no gap detection, malformed frames are dropped silently, and
every surface other than the transcript and the notification inbox has no
sequence at all. Four polling timers exist to compensate. The recurring reports
of stuck cards, lost messages after a drop, and a notification count that
disagrees with the drawer are all explained by this shape.

The guarantee this change states, in observable terms: **when the app shows a
session, what is shown is what the server holds, or the app says it does not
know and repairs itself** — never a stale value rendered as current.

## What Changes

- **BREAKING** for any code that treated a missed frame as acceptable: every
  per-session frame carries a monotonic sequence, and the client detects a gap
  (`lastSeen + 1` missing) instead of applying events blindly.
- On gap detection the client repairs from the server: resync the affected
  surface, then resume streaming. Repair is bounded and visible if it fails.
- The notification count and the drawer content move to one sequenced transport;
  a summary that cannot be reconciled triggers the same resync, so the count and
  the drawer cannot disagree.
- The delivery-reconcile and subagent/activity polls become repair paths of last
  resort, not the primary mechanism; each one that a sequenced stream makes
  redundant is removed rather than left running.

## Capabilities

### New Capabilities

- `chat/state-consistency`: the guarantee that what a session view shows matches
  what the server holds, how a gap is detected, how the view repairs, and what
  the reader is told while repair is happening or has failed.

### Modified Capabilities

None. The three sibling changes own panel honesty, geometry stability, and
warning delivery; this change owns the transport guarantee underneath them.

## Impact

- `src/server/realtime/sessionEventHub.ts` — seq exists per session
  (`seqBySession`, line 28; stamped at publish, lines 88-95) but global frames
  are sent unsequenced (`publishRealtime`, line ~130). A cursor-replay or
  resync endpoint needs a bounded buffer or a "repair = refetch" contract.
- `src/client/src/sessionSocket.ts` — `withTransportSeq` (lines 283-289) stamps
  seq onto events but nothing compares consecutive values;
  `safelyParseValidatedEvent` (lines 291-299) drops malformed frames silently.
- `src/client/src/controllers/sessionController.ts` — the watermark
  (`streamWatermark`, lines 150-155) is consumed only by
  `isStreamEventBelowWatermark` (lines 2162-2168) at join; reconnect refetches
  the latest page, status, snapshot and inbox (lines 1399-1412) rather than
  replaying from a cursor.
- `src/client/src/sessionNotifications.ts` — `inboxRevision` strict `+1` check
  with resync (lines 111-152) is the working model this change generalises.
- `src/client/src/components/PiWebApp.ts` — the 4 s subagent poll (line 217,
  timer at 695-702) and the 10 s delivery reconcile (line 221, logic at 678-690)
  exist because the evented path is not trusted.

## Non-goals

- Panel load-state honesty (unloaded/failed/key-mismatch/empty) — owned by
  `honest-panel-states`. This change detects and repairs divergence; that change
  renders what a load returned.
- Geometry stability of waiting surfaces — owned by
  `steady-surface-and-visible-actions`.
- Moving warnings into the notification drawer — owned by
  `warnings-belong-in-notifications`.
- Changing the terminal socket, the auth device-flow poll, or the 15-minute
  self-update check: the first two have no session-state semantics, the third
  is not message sync.
- Server-side persistence format changes.
