# What to take from stablyai/orca

Three lanes cloned the repository and reported with `file:line` on both sides
(archived under `docs/design/research/orca-*.md`). This page is the decision
sheet: what we should borrow, what we must adapt, and what we should not copy.
Nothing here is implemented yet.

The owner's framing was that orca's management side is written well while its
chat surface is weak, and that we should also look at caching, lazy loading and
prefetching. All three held up.

## Two claims verified locally before writing this

- `src/client/src/chatHistoryCache.ts:29-34` writes to `sessionStorage` and
  swallows the quota failure with no eviction, so **a transcript large enough to
  exceed the budget is never cached** — and those are the ones where caching
  matters. This is a bug, not a trade-off.
- The client ships **one 1,016,264-byte entry chunk** (`dist/client/assets/
  index-*.js`); there is no route or feature splitting.

## The idea worth taking first: ambiguity is a value

`orca:src/shared/pty-write-settlement.ts:30-40` models a settlement as three
arms — `accepted`, `refused{reason}`, `unverifiable{reason,
bytesHandedToTransport}` — and its header records why: flattening those three
into a boolean once let a lost settlement clear a durable reservation and write
the same bytes twice. `orca:docs/reference/ssh-execution-boundary.md:12` states
the matching rule in words: *loss of contact is not evidence of `exited`; report
`unverifiable`, never `exited`*, and the vocabulary `live / unverifiable /
exited` is fixed repository-wide with no synonyms allowed.

We have the opposite shape today: `commandLedger.ts:20` is `pending | ok |
failed`, and a 30s fetch deadline is rendered as a page-level fault
(`operation-model.md`). `unverifiable` is exactly the state our diagnosis said
was missing, and `bytesHandedToTransport` is the fact a reconnect needs to
answer "is resending safe?".

## The management-side borrows, ranked

| # | Borrow | Orca evidence | Cost | Touches |
|---|---|---|---|---|
| 1 | Three-armed settlement with ambiguity carrying facts | `pty-write-settlement.ts:30-40` | low (types + classifier) | `messageDelivery.ts`, `commandLedger.ts`, later the daemon receipt |
| 2 | Fixed vocabulary, no synonyms, no collapsing | `docs/reference/ssh-execution-boundary.md:12-14` | low | `src/shared/`, every surface, docs |
| 3 | A deadline bounds waiting, never cancels durable work | network lane §3 | medium | `requestDeadline.ts` callers, state machine |
| 4 | Persistent operation ledger: `pending/succeeded/failed/unknown`, replay beats re-execute, payload fingerprint, capacity **refuses** rather than evicts | `agent-session-operation-ledger.ts:26-60,140-165` | medium-high | `acceptanceLedger.ts` (today: in-memory, "a daemon restart forgets the ledger"), `apiTypes.ts` |
| 5 | Journal the submission **before** dispatch; the optimistic bubble *is* the durable row, so an echo reconciles instead of appending a copy | `journal-store.ts:225-228,241` | medium | prompt path, `apiTypes.ts` |
| 6 | Restart downgrades `pending` to `unknown`; never resend for the user | network lane §5 | low | daemon restart path |
| 7 | Absent answers must carry an evidence mark; no mark means ambiguous | architecture lane §5 | low | receipt protocol |
| 8 | Endpoints named by semantic protocol version; a daemon holding live sessions survives a version bump | architecture lane §4 | low-medium | `sessiondClient/`, `sessiond.ts`, install docs |

## The silky-UI borrows, ranked

| # | Borrow | Orca evidence | Cost |
|---|---|---|---|
| 1 | Stale-while-revalidate on session switch (serve cache, refresh behind it) | `hosted-review.ts:305-315`, `cache-policy.ts:3-15` | ~1 day |
| 2 | Byte-budgeted LRU for transcripts, with eviction | `transcript-read-cache.ts:39-47` | ~0.5 day (also fixes the bug above) |
| 3 | Generic in-flight GET dedupe at the API boundary | `in-flight-promise-dedupe.ts` (83 lines) | ~0.5 day |
| 4 | Prefetch on intent (hover/focus on session rows) | `SidebarTaskNavButton.tsx:164` | ~0.5 day |
| 5 | Route/feature code splitting with chunk-load retry | `lazy-with-retry.ts:253` | 3-5 days |
| 6 | Input-quiet gating for expensive publishes; jitter on visibility resume | cache lane §6, §8 | low |
| 7 | History paging: three directions, byte budget, clamp instead of refuse, enumerated cursor-invalidation reasons | network lane §14 | medium |

## What not to copy

- **Its chat surface.** Orca's transcript is a terminal snapshot with a bounded
  replay (`pty-handler.ts:340`, 100 KB tail; its own docs admit output beyond
  that is lost). Our streaming pipeline is better: incremental markdown append,
  incremental grouping, trailing-refresh coalescing, gap repair with sequence
  replay, and an explicit loading/empty/failed transcript state. The cache lane
  found no orca equivalent for the last two.
- **Control plane bound to a live client.** On an orca SSH host, every `orca …`
  command fails when the owning client disconnects.
- **Its shape.** Electron desktop plus a cloud relay, a phone companion and
  multi-tenancy. The multi-tenant fence broker and canary flow solve problems we
  do not have.
- **Transcript virtualization** — orca chose against it too; that validates our
  current choice rather than arguing for a change.

## The open decisions this changes

Our own `operation-model.md` offered A (full ledger) / B (correlate and be
honest) / C (honesty patch). The evidence moves two things:

1. Orca does **not** put every action in one ledger. It uses four mechanisms
   graded by *the cost of doing the thing twice*. That argues against a
   monolithic option A and for a graded model: cheap idempotent reads need
   nothing, sends need the journal, spawns need the persistent ledger.
2. "A deadline bounds waiting, not work" and "`unknown` is a first-class state"
   are not a matter of taste; both have costed implementations behind them.

What still needs the owner: **where the persistent ledger lives** (daemon-side
rows vs an in-memory ledger plus a reconnect query), and **whether replay may
ever be automatic** (orca's answer is no for host-confirmed unknowns — the user
presses retry).
