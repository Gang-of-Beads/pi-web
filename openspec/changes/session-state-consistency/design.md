## Context

Investigation result (all paths verified, not inferred):

- The hub stamps a monotonic per-session `seq` on every published frame
  (`sessionEventHub.ts:88-95`) and exposes the watermark for join snapshots
  (`currentSeq`, lines 100-106). Keepalive every 20 s (line 23).
- The client uses `seq` exactly once: at join, `streamSnapshot` returns
  `{ seq, partial }` read in one tick (`piSessionService.ts:2256-2275`), and
  `isStreamEventBelowWatermark` (`sessionController.ts:2162-2168`) drops
  buffered events at or below it. After join, `withTransportSeq`
  (`sessionSocket.ts:283-289`) stamps the value onto the event and nothing ever
  compares it again. **Mid-stream gap detection does not exist.**
- Validation failures vanish: `safelyParseValidatedEvent`
  (`sessionSocket.ts:291-299`) returns undefined on throw; the caller drops the
  event with no counter, no log, no resync.
- Global frames carry no sequence at all: `publishRealtime`
  (`sessionEventHub.ts:~130`) sends raw JSON; `activity.update`,
  `status.update` for other sessions, `session.created`, and
  `notifications.summary` all ride this path (`piSessionService.ts:1507, 2793,
  3913, 4150, 4369, 4389`).
- `publishNotificationSummary` drops its frame entirely when no global
  subscriber is connected — the count can silently miss an update.
- Reconnect = full refetch of the latest messages page, status, stream
  snapshot, and inbox (`sessionController.ts:1399-1412`), wired from the
  socket's reconnect callback (`:306-308`). Recovery is by refetch, not replay;
  content older than one page returns only via manual load-earlier.
- Silent death is bounded: liveness timeout 50 s against the 20 s keepalive
  (`sessionSocket.ts:11-17`), checked every 15 s (`PiWebApp.ts:234, 890`) plus
  on visibility/online events. The comment at `sessionSocket.ts:15-17` records
  that this exists because "the page only updates if I refresh it" was real.
- The notification inbox already has the strict mechanism: `inboxRevision`
  must be exactly `current + 1` or the client resyncs
  (`sessionNotifications.ts:111-152`).
- Polls compensating for untrusted events: 4 s subagent/activity poll
  (`PiWebApp.ts:217`, timer at 695-702); 10 s delivery reconcile, armed while a
  sent message lacks its echo (`PiWebApp.ts:221, 678-690`); 1 s terminal
  command-run poll (`TerminalPanel.ts:24, 265`); 1 s workspace-deletion poll
  (`PiWebApp.ts:2716`). Not sync-related: 15-min self-update check, 1 s turn
  clock, dialog countdown, auth device flow.

Why the live evidence fits: cards stuck PENDING and messages lost after a drop
— asks and dialogs ride the per-session socket with no revision check, so a
frame missed during a silent death (or swallowed by a validation throw) leaves
the card until the next full refetch; notification count vs drawer — the count
travels on the unsequenced global summary, the list on the revision-checked
inbox; two transports, one surface, and the unsequenced one has no way to know
it is stale.

## Goals

- The reader's view converges on the server's state after any loss, without a
  page reload, and says so when it cannot.
- Loss is detected by sequence, not by timeout alone.
- Timers that exist only to compensate for undetected loss are removed, not
  left running beside the fix.

## Non-goals

Panel honesty (`honest-panel-states`), geometry stability
(`steady-surface-and-visible-actions`), warning delivery
(`warnings-belong-in-notifications`), terminal and auth transports, server
persistence formats.

## Decisions

### D1 — Repair shape: replay from cursor vs revision-checked resync

The notification inbox demonstrates the cheap strict pattern: carry a revision
on every state surface, require exactly `current + 1`, resync the whole surface
otherwise. The transcript demonstrates the expensive strict pattern: a
watermark plus a server that can replay from a cursor.

- **Resync-everywhere (recommended for status/activity/dialogs/inbox-summary)**:
  no server buffer, no new endpoint, reuses the refetch that reconnect already
  performs; cost is a bounded extra fetch on a gap, which on these small
  surfaces is cheap. This is the inbox pattern generalised.
- **Cursor replay for the transcript only**: a missed transcript frame cannot
  always be repaired by refetching the latest page when the reader is scrolled
  into history, so the transcript keeps its watermark and gains a
  `?since=seq` replay backed by a bounded ring buffer server-side. Cost: a new
  endpoint and buffer management; benefit: no refetch storm when one frame is
  lost during a long stream, and scrolled-back views repair in place.
- **Keep polling, render staleness**: rejected as the primary mechanism — the
  owner named it slow and imprecise, and it leaves loss undetected. It survives
  only where no push channel exists (auth device flow).

The owner chooses between "resync everywhere" and "resync + transcript replay";
both satisfy the spec's repair requirement. The replay endpoint is the only
piece with real server cost.

### D2 — Scope of sequencing

Per-session scopes inherit the hub's seq. Global scopes (cross-session
status/activity, unread, notification summary) gain their own monotonic
counter, stamped by the hub at publish. Backward compatibility: a frame without
a sequence fails open exactly as today (`withTransportSeq`), so a federation
peer that has not been upgraded degrades to the current behaviour instead of
breaking — but a gap between sequenced frames is always actionable.

### D3 — Malformed frames are gaps

A frame that fails validation currently vanishes. Under this change a
validation failure on a sequenced scope is treated as a gap: the client stops
applying that scope blind and resyncs it. A parse failure today is indistinguishable
from a lost frame tomorrow; treating them alike is what makes the guarantee
real. Repeated repair failures surface as the stale-state claim, not silence.

### D4 — Which polls die

On landing: the 10 s delivery reconcile and the 4 s subagent poll are removed
once their surfaces are sequenced and repaired (their compensations move into
the repair path). The 1 s deletion poll and the terminal command-run poll stay
until their surfaces are evented — out of scope here; each must name the
surface it backs up (spec requirement). Liveness checking stays: it is the
detector that gets the socket reconnected; with sequence in place its failure
mode becomes "reconnect", not "stale forever".

## Risks / Trade-offs

- The resync-on-gap path can amplify load after a daemon restart, when every
  client detects a gap at once. Mitigation: the reconnect refetch is already
  the same shape and is jittered; the resync rides the same trailing-refresh
  coordinator rather than adding a new path.
- Strict `+1` revision checks break if the server ever skips revisions
  legitimately (e.g. pruning). The inbox already encodes the escape hatch
  (`resync` delta kind); the design for each surface must state when the server
  may skip and why that is safe.
- Removing the delivery reconcile before its surface is truly sequenced would
  reintroduce silent message loss — the spec forbids removing a poll before the
  evented path carries its data, and the e2e task below must show a delivered
  message with the poll removed.

## Migration Plan

1. Stamp global frames; teach the client to track last-seen per scope (no
   behaviour change yet — gaps logged, not acted on). Ship dark.
2. Turn gap detection into repair for the small surfaces (status, activity,
   dialogs, inbox summary) via resync; unify the notification count and drawer
   onto the sequenced summary.
3. Add transcript cursor replay; wire gap repair for the transcript.
4. Remove the delivery reconcile and the subagent poll; name any survivor.
5. e2e on 8505 at each landing (tasks below), not only at the end.
