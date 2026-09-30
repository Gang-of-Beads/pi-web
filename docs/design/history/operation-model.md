# The operation model: making PI WEB feel like the TUI

Reported by the owner, 2026-09-09, with a screenshot: a `/reload` card read
`running…`, was discarded, kept running, then failed; a red
`The server did not answer within 30s.` banner sat at the top of the page while
the transcript below it was still receiving output.

This page is the diagnosis and the options. No code has been changed for it.

## What the branch actually does today

Every user action travels on **two independent channels that never learn about
each other**:

| channel | who owns it | what it knows |
|---|---|---|
| HTTP request/response | `src/client/src/api/http.ts`, deadline in `api/requestDeadline.ts` (30s, uploads 180s) | whether *this attempt* was answered in time |
| realtime socket | `src/client/src/sessionSocket.ts`, liveness in `socketLiveness.ts` (keepalive 20s, silence budget 42s) | what the daemon is actually doing |

Consequences, each verifiable in the current code:

1. **A timeout is a statement about one fetch, not about the work.**
   `RequestTimeoutError` (`requestDeadline.ts:29`) aborts the request and the
   notice layer (`noticeFromError` in `notice.ts`) raises a machine-scoped
   banner — the aborted fetch's URL names the machine it was talking to
   (`machineIdFromUrl`), so the claim belongs to that machine and its own
   answers retire it. The daemon keeps
   running the command; the socket keeps delivering its output. Both statements
   are true and they contradict each other on screen.

2. **The deadline ignores the liveness the app already measures.** (The
   suppression branch once sketched in `notice.ts` was removed in round 27:
   no production caller can prove liveness, so the seam stays open rather
   than pretending the verdict exists. The socket knows the link answered a
   keepalive 3 seconds ago; `deadlineSignal()` does not consult it, so a
   slow-but-healthy link produces "the server did not answer" while the same
   server is demonstrably answering.)

3. **Commands have no identity.** Messages carry `clientMessageId` end to end
   and have a real delivery state machine (`messageDelivery.ts`:
   pending → queued → delivered/failed, with reconciliation rules). Commands
   have `commandLedger.ts` with three states (`pending | ok | failed`), no id
   the server echoes, no reconciliation, and **no cancel**: `dismissCommand()`
   refuses a pending row on purpose, so "discard" is only ever a receipt-hiding
   action. What the owner discarded was the card, never the work.

4. **Nothing represents "unknown".** When an attempt is abandoned the row stays
   `pending` until some later event settles it — or forever. The app has no way
   to say "this was sent, the answer was lost, here is how to find out", which
   is exactly the state a flaky link produces most often.

5. **Faults are page-scoped, operations are not.** The banner names no
   operation, so a failure of one action reads as a failure of the app.

The TUI feels different not because it is faster but because there is exactly
one channel, one identity per action, and every state is named.

## The shape being proposed

One **Operation** record for every user-initiated action — send message, run
command, abort, rename, cleanup, reload, switch model — carrying:

- `operationId` (client-minted, echoed by the server),
- the scope it belongs to (machine + project + workspace + session),
- `intent` (what it asked for, enough to describe and to retry),
- one state machine, enumerated in a pure classifier and tested exhaustively:

```
draft → submitting → accepted → running → settled(ok | failed)
                  ↘ unknown(link lost / no answer) ↗ (reconciled)
                  ↘ cancelled(user, before or after acceptance)
```

Rules that follow from it, and that the current code violates:

- **The link speaks about the link; an operation speaks about itself.** The page
  banner is reserved for connection state (offline / reconnecting / degraded)
  from `socketLiveness`. A lost answer becomes `unknown` **on that operation's
  row**, with a "check again" action.
- **A deadline that a live socket contradicts is not a failure.** While the
  socket is proven live, an unanswered request becomes `unknown`, not `failed`.
- **Discard means one thing.** Either it cancels the work (needs a server-side
  cancel for that intent) or it is unavailable while the work is live. It never
  hides live work behind a settled-looking UI.
- **Reconnect reconciles.** The daemon keeps a bounded log of recent operations
  by id; on reconnect the client asks for the outcomes of every non-settled
  operation it holds, so `unknown` resolves without a page reload, and a resend
  with the same id is idempotent instead of duplicating work.

## Options (the owner chooses)

**A. Full operation ledger.** Unify messages, commands and control actions on
one record and one state machine; server-side operation log with idempotent
resubmit and reconnect reconciliation; per-operation UI everywhere; page banner
demoted to link state. Largest change: touches the daemon protocol, the client
controllers and every surface that shows an action. Gives the TUI-like property
the owner asked for: every operation's state is known and nothing contradicts.

**B. Correlate and be honest.** Keep the two channels, but give commands an id
the server echoes, make deadlines liveness-aware, add the `unknown` state with
a per-row "check again", move the fault from the page banner onto the row, and
add cancel where the daemon already supports abort. No new server log, so
`unknown` resolves by asking again rather than by replay. Medium change,
mostly client-side.

**C. Honesty patch only.** Scope the banner to the operation that failed, stop
calling a live-link timeout a failure, and either allow cancel-and-mark-unknown
or grey out discard while work is live. Small, ships today, leaves the two
channels uncorrelated — the contradiction becomes rarer and better labelled,
not impossible.

## Open questions for the owner

1. Which option, and may B/C be a step on the way to A rather than a
   destination?
2. What should "discard" mean on a live command: cancel the work, or be
   unavailable until it settles?
3. Should `unknown` be visible as its own state, or presented as "still
   working" until reconciliation proves otherwise?
4. Does this work pause the visual-convergence rounds, or interleave with them?


## Status: what landed (updated 2026-09-09)

The diagnosis above described the branch when the page was written. Most of it
is now fixed, task by task in the goal, each with its own probe:

- **Three-arm settlement** (`src/shared/operationSettlement.ts`): accepted /
  refused / unverifiable, with fixed vocabulary and a guard test banning the
  old ambiguous words. (The live-link timeout itself still claims "the
  server did not answer" while the socket is alive — consequence 2's seam
  is the recorded open piece, not yet wired.)
- **A durable operation ledger in the daemon** (`operationLedger.ts`,
  wired through `sessiond.ts`): append-only, fingerprint-checked, capacity
  rejects rather than evicts, restart downgrades pending to unknown.
- **Reconnect asks once** (`POST /sessions/:id/operations`): the client
  reconciles on reconnect; absence is not failure.
- **Write-before-send commit rows** stop flickering: markers are persistent
  elements toggled by class, not swapped templates (measured 17 → 6 DOM
  removals per turn).
- **The silky four**: transcript cache eviction with the quota bug fixed,
  in-flight read sharing, prefetch on intent (first paint 11ms after hover),
  and lazy dialog surfaces (entry bundle 1,021,012 → 781,205 bytes) with
  honest load-failure reporting.

Still open, and deliberately so:

- **Deadline does not consult liveness yet.** The settlement vocabulary is in
  place. Round 21 retired the dead proactive half of this item: the wording
  table rewrites a deadline miss to a transient line that withdraws itself,
  and the machine's own answers retire the claim. Teaching the deadline to
  consult the socket's keepalive facts remains the open piece of
  consequence 2 — the `link` argument was removed with its unreachable
  branch in round 27.
- **Commands still have no server-side identity or cancel.** The ledger knows
  operations, but the command rows predate it and were not migrated.
- The phone single-bar fold and the plugin-kernel boundary (see
  `surfaces-as-plugins.md`) are separate tracks with their own documents.
