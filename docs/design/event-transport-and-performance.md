# Event-based transport and long-session performance: design proposal

Owner directives: long sessions load lazily by position (indexed), the next
page prefetches / refreshes in the background, and the transport moves to
events to save bandwidth — with replay and recovery semantics worked out
for network failures.

## What already exists (verified, file:line)

- **The live stream is already event-based.** `SessionUiEvent`
  (src/shared/apiTypes.ts:1432-1456) carries `message.append`,
  `assistant.delta`, `tool.start/update/end`, `shell.chunk`,
  `status.update`, `activity.update` — frames stamped with `seq`
  (`SessionUiEvent = SessionUiEventBody & { seq?: number }`).
- **Replay and recovery exist for the live stream.** A seq jump on the
  socket opens a gap: `sessionGapRepair.ts` holds live frames, requests a
  replay with `sinceSeq` (daemon endpoint at sessionRoutes.ts:244), applies
  the replayed window, flushes the buffer, and falls back to one full
  authoritative read (`resync`) when replay fails or the verdict says so.
  States: `idle` / `repairing`; requests coalesce.
- **History is snapshot-paged.** `messagePaging` loads full-message pages
  (`MESSAGE_PAGE_SIZE`) over HTTP at safe boundaries; the rendered transcript
  accumulates every loaded page; `chatHistoryCache` caches page results per
  session with quota.
- **Lists are full-refetch.** Session/project/workspace listings and status
  hydration re-fetch whole payloads on focus/resume/poll; no revision
  cursors on the wire except the notification catalog's.

## Gap analysis

1. A long session opened mid-way costs one full page immediately and one
   per scroll boundary — fine — but the DOM keeps every loaded row, and
   nothing prefetches the page the reader is walking toward.
2. A reload re-fetches the transcript pages it already had: the
   `chatHistoryCache` has the rows but no wire-level cursor ("I have
   through K") exists, so the daemon cannot send only the delta.
3. List refreshes ship full snapshots where a revision check would often
   say "nothing changed".

## Proposal

### A. Indexed lazy loading (the transcript)

- The transcript is already position-keyed (anchor keys `m:<index>`). Add a
  scroll-position index over loaded pages: pages render inside anchored
  ranges; rows far outside the viewport (+/- 2 pages) collapse to
  fixed-height placeholders derived from the page's message count (the
  layout contract already keys row height, so placeholders keep the
  scrollbar honest without rendering 10k nodes).
- Placeholder expansion is driven by the same reading-position state that
  drives history loads — no new state machine, one registry keyed by page
  index.

### B. Next-page prefetch and background refresh

- Prefetch the next history page at 60% scroll toward either boundary
  (upward exists as a boundary load; this adds the intent-based head
  start). The prefetch writes into the same page cache — no separate state.
- Background refresh: session/status/list re-fetches gain a revision check
  (the notification catalog already has `catalogRevision`; reuse the
  pattern) so an unchanged backend answers a cheap 304-style verdict
  instead of a full payload.

### C. Event transport for the delta (the bandwidth win)

- Extend the existing seq replay to cover committed history: the client
  stores its last applied seq per session (the watermark the gap repair
  already tracks); on reload or reconnect, the request becomes
  "replay after watermark K" instead of snapshot pages. The daemon's ring
  buffer answers from K; a too-old watermark answers resync-with-snapshot,
  which then seeds the watermark.
- Replay/recovery semantics stay exactly the shipped ones: watermark,
  replay, dedup-by-seq, resync-on-failure — generalized from the live tail
  to the whole transcript. No new recovery state machine.

### D. Sequencing

1. B (prefetch + revision checks) — smallest, no wire changes.
2. A (render windowing) — biggest long-session win, client-only.
3. C (delta replay for history) — wire change, last, behind the shipped
   gap-repair semantics.

## Deferred decisions for the owner

- Whether placeholder collapsing (A) is wanted at all, or whether
  capping loaded pages with a "load older" affordance is enough.
- Whether C applies to session LIST payloads too, or only transcripts.
