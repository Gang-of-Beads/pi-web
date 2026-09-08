# Research: Extreme perceived performance and state synchronization for a live agent-session web client (PI WEB)

## Runtime limitation — read this first

**This run had no web tooling.** The only tools registered for this subagent were `Read` and `Write`. No `web_search`, no page fetch, and no `source_check` were available, so **no external source was fetched or validated during this run**.

Consequences, stated honestly rather than papered over:

- Every claim about *this repository* is **direct evidence**: I read the files and cite `path:symbol`.
- Every claim about *other teams / specs / frameworks* is **recalled prior knowledge, UNVERIFIED at runtime**. Where I give a URL it is a pointer to where the claim should be checked, not proof that I read it today. I have avoided quoting numbers, benchmark figures, or wording I am not confident about, and I have marked the ones I do give.
- No recommendation below depends solely on an unverified external claim. Each one is justified by a failure mode visible in this codebase.

If the parent wants the external half hardened, the follow-up is a second pass with search enabled against the "Next steps" list at the end.

---

## Summary

PI WEB is already at, or slightly past, the state of the art for its shape: an event-sourced session stream with a per-session monotonic `seq`, a server-side replay ring, a join-time watermark for exactly-once application, a gap detector that holds live frames while replaying, and an honest fallback to an authoritative read when replay cannot serve (`src/server/daemon/realtime/sessionEventHub.ts`, `src/client/src/sessionSocket.ts`, `src/client/src/sessionGapRepair.ts`, `src/client/src/controllers/sessionController.ts`). **The correct answer to "should we adopt CRDTs / Replicache / Electric / Zero / PowerSync" is no**: those systems buy multi-writer offline convergence, and this product has exactly one writer of transcript truth (the daemon) plus one small, already-idempotent client write (the user message).

The remaining wins are cheap and local: (1) **layout-stable rendering** — `content-visibility: auto` + intrinsic sizing and intrinsic image dimensions, instead of correcting scroll after the fact; (2) **a branded scope key** so a bare `sessionId` cannot reach the transcript cache; (3) **closing the exactly-once hole on the request-timeout path**, which is the one place a user message can plausibly be delivered twice; (4) **honest "restored from cache / reconciling" state** on the fast first paint.

Virtualization, streaming SSR, service-worker offline sync, and a sync engine are over-engineering at self-hosted single-user-to-small-team scale, and several of them would *delete* correctness properties this repo already paid for.

---

## Findings

### A. First paint of session content

1. **Claim:** PI WEB already does local-first first paint for transcripts: the raw message page is cached in `sessionStorage` under `pi-web:chat-history:v2:<key>` with a 30-minute TTL, read synchronously on selection, and merged with the authoritative page when it arrives.
   **Sources:** `src/client/src/chatHistoryCache.ts` (`CACHE_PREFIX`, `CACHE_TTL_MS`, `mergeChatHistory`), `src/client/src/chatTranscriptStore.ts` (`ChatTranscriptStore.cachedView`, `mergeHistory`, `MAX_IN_MEMORY_TRANSCRIPTS = 12`).
   **Support:** direct evidence. **Confidence:** high.
   **Trade-off:** synchronous `sessionStorage` reads block the main thread and the quota is small (commonly ~5 MB per origin, *recalled, UNVERIFIED*), so a very large transcript page silently fails the write (the code swallows quota errors by design). The failure mode this prevents is the empty-transcript flash on every session switch.

2. **Claim:** Streaming SSR is the wrong tool here; the industry pattern it competes with (skeleton + client cache) is what this app already has, and SSR would require a rendering server in a product whose whole architecture is "browser is a control surface, work lives on the daemon".
   **Sources:** repo shape — `vite.config.ts` (`root: "src/client"`, static SPA build to `dist/client`), `README.md` ("Your browser is the control surface"); general SSR/streaming background (UNVERIFIED, not fetched): <https://react.dev/reference/react-dom/server> , <https://web.dev/articles/rendering-on-the-web>.
   **Support:** interpretation (repo shape is direct; SSR characterization is recalled). **Confidence:** high for the recommendation, medium for the external framing.
   **Trade-off:** SSR would improve cold first paint for a *new* visitor on a slow link; it would cost a server render path, hydration mismatch risk against a live WebSocket stream, and a second source of truth for transcript markup. For a LAN/self-hosted tool where the bundle is usually warm in cache, the payoff is close to zero.

3. **Claim (gap, actionable):** The cache-first paint currently has no rendered "this is cached, not yet reconciled" state that I could find, which is in tension with the project's "absence is not negation" rule — a stale cached transcript is indistinguishable from a reconciled one during the window before the authoritative read lands.
   **Sources:** `src/client/src/chatTranscriptStore.ts` (`cachedView` returns a plain `ChatTranscriptView`; no freshness field), `src/client/src/transcriptLoadingOwnership.ts` (imported by `sessionController.ts` as `transcriptLoadingAfter`, which I did **not** read in full).
   **Support:** interpretation from a partial read. **Confidence:** medium — I did not read `transcriptLoadingOwnership.ts` or the full `ChatView` render path, so a freshness indicator may exist under another name. Verify before acting.
   **Recommendation:** carry `savedAt` through `ChatTranscriptView` as a `staleness: "fresh" | "restored"` field and render a one-line quiet marker until the first authoritative merge. Failure mode prevented: the owner-recorded class of bug where retained data reads as current data.

### B. Sync mechanism for this shape

4. **Claim:** The current mechanism is *event sourcing with a resumable cursor*, not "WebSocket + revision numbers" in the naive sense. The hub stamps every per-session frame with a monotonic `seq`, keeps a bounded per-session replay ring (default 256 frames per session, LRU over 256 sessions), and the client replays `sinceSeq` on a counted gap; failure to serve the replay falls back to a full authoritative read exactly once.
   **Sources:** `src/server/daemon/realtime/sessionEventHub.ts` (`seqBySession`, `replayBySession`, `replayBufferLimit ?? 256`, `MAX_REPLAY_SESSIONS = 256`, `MAX_SOCKET_BUFFERED_BYTES = 1 MiB`, `KEEPALIVE_INTERVAL_MS = 20_000`), `src/client/src/sessionGapRepair.ts` (states `idle`/`repairing`, `appliedSeqs` set, `fallBackToResync`), `src/client/src/sessionSocket.ts` (`ScopeSeqMonitor`, `LIVENESS_TIMEOUT_MS = 50_000`).
   **Support:** direct evidence. **Confidence:** high.

5. **Claim:** Exactly-once *application* at join is already solved by a watermark: the stream snapshot captures the hub `seq` alongside the seeded partial, and buffered/live events at or below it are dropped.
   **Sources:** `src/client/src/controllers/sessionController.ts` (`streamWatermark`, doc comment "buffered/live events with `seq <= seq` are already reflected in the committed history + seeded partial"), `src/client/src/sessionSocket.ts` (`withTransportSeq`, which fails open for unstamped frames).
   **Support:** direct evidence. **Confidence:** high.
   **Residual risk (researcher inference):** `withTransportSeq` and `ScopeSeqMonitor.observe` both *fail open* on a frame with no numeric `seq`. That is the right call for peer-version skew, but it means a future frame type that forgets its stamp degrades silently to at-least-once with no gap accounting. A test that asserts every frame type emitted by the hub carries `seq` would make that a CI failure instead of a field report.

6. **Claim:** CRDTs are not justified here. A CRDT buys convergence for concurrent writes to shared mutable state without a coordinator. In PI WEB the transcript is append-only and written by exactly one authority (the daemon owns the session runtime), while browsers write only user messages that already carry a `clientMessageId` correlation id.
   **Sources:** repo — `src/client/src/messageDelivery.ts` (`newClientMessageId`, delivery state machine `sending → received → queued → delivered | failed`), `AGENTS.md` (sessiond owns session runtime); CRDT background (UNVERIFIED, not fetched): <https://crdt.tech/> , <https://automerge.org/> .
   **Support:** repo evidence direct; CRDT characterization recalled. **Confidence:** high for the recommendation.
   **Cost avoided:** per-document metadata growth, a merge model for tool-call/tool-result structures that are not naturally mergeable, and the loss of the property that "the daemon's file is the truth" — which is what makes `refreshSelectedSession()` a legitimate universal repair.

7. **Claim:** Local-first sync engines (Replicache, ElectricSQL, Zero, PowerSync) are also not justified, and adopting one would add a replication/schema server plus a client persistence layer to solve problems this app does not have (offline multi-writer, partial replication of a large shared DB, cross-user conflict).
   **Sources:** UNVERIFIED, not fetched — <https://replicache.dev/> , <https://electric-sql.com/> , <https://zero.rocicorp.dev/> , <https://www.powersync.com/> . Repo counter-evidence: `src/client/src/pendingOutbox.ts` implements exactly the small slice that matters (persisted per-session outbox, retried on `online`, one line per unsent message).
   **Support:** repo evidence direct; product characterizations recalled. **Confidence:** medium-high.
   **Trade-off named:** what a sync engine would genuinely buy is *cross-tab and cross-device convergence of local mutations while offline*. PI WEB's offline surface is one composer message per session; `pendingOutbox.ts` covers it in ~120 lines with no server component. The failure mode a sync engine would prevent (divergent local writes) does not exist while the daemon is the only writer.

8. **Claim:** Naive polling is already correctly demoted to a fallback rather than a mechanism; there is a dedicated classifier for when activity polling is even allowed.
   **Sources:** `src/client/src/sessionActivityPolling.ts` (imported into `PiWebApp.ts` as `oneReadAtATime`, `shouldPollSessionActivity`), `src/client/src/controllers/sessionController.ts` (`onBackgroundRunCountChanged` doc: "the strip can refetch on demand instead of on a timer").
   **Support:** direct evidence (import sites and doc comments read; I did not read `sessionActivityPolling.ts` itself). **Confidence:** medium-high.

9. **Claim:** What breaks when the socket drops mid-turn is well covered, with one bounded honest-degradation case: if more than `replayBufferLimit` frames were stamped for that session while the client was away (a long tool-heavy turn on a backgrounded phone), the replay cannot serve the range and the client resyncs from the authoritative read.
   **Sources:** `src/server/daemon/realtime/sessionEventHub.ts` (ring bound), `src/client/src/sessionGapRepair.ts` (`fallBackToResync` — "the buffer's frames are real arrivals ... the missing range is rebuilt by the full read"), `src/client/src/sessionSocket.ts` (`checkLiveness` drops a dead-but-OPEN socket and *schedules its own reconnect*, because the quiet close detaches `onclose`).
   **Support:** direct evidence. **Confidence:** high.
   **Trade-off:** raising the ring bound trades daemon memory for fewer full resyncs. At 256 frames/session × 256 sessions the ceiling is bounded but the frames are whole `SessionUiEvent`s, so the real cost is content-dependent (a tool result with a large payload is a large ring entry). **Researcher inference:** if resyncs are observed in practice, bound the ring by *bytes* as well as by count — the socket path already has a byte bound (`MAX_SOCKET_BUFFERED_BYTES`), the ring does not.

### C. Transcript-scale rendering

10. **Claim:** The transcript is paged, not virtualized: `MESSAGE_PAGE_SIZE = 100` with backward paging triggered near the top, plus prepend scroll anchoring; the render path groups messages and uses Lit's `repeat` directive over the loaded window.
    **Sources:** `src/client/src/controllers/sessionController.ts` (`const MESSAGE_PAGE_SIZE = 100`), `src/client/src/chatHistoryLoading.ts` (`shouldRequestEarlierMessages`, `DEFAULT_TOP_THRESHOLD = 600`, `doesNotFillViewport`), `src/client/src/components/ChatView.ts` (imports `repeat` from `lit/directives/repeat.js`, `capturePrependScrollAnchor`/`restorePrependScrollAnchor`, `chatGroups`).
    **Support:** direct evidence for paging/anchoring; **partial** for "no virtualization" — I read roughly the first 120 and a 200-line middle slice of a ~2,390-line file and found no windowing, but I did not read it end to end. **Confidence:** medium-high (flagged UNVERIFIED for the negative).

11. **Claim (recommendation):** Prefer `content-visibility: auto` + `contain-intrinsic-size` on message articles over a virtualized list.
    **Sources:** UNVERIFIED, not fetched — <https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility> , <https://web.dev/articles/content-visibility> .
    **Support:** interpretation. **Confidence:** medium (the CSS mechanism is well established; I have deliberately not quoted a speedup figure).
    **Trade-off, named:** virtualization gives an O(viewport) DOM regardless of transcript length, but it destroys browser find-in-page across unrendered rows, invalidates the existing `capturePrependScrollAnchor`/`restorePrependScrollAnchor` and `ChatScrollController.restorePosition` machinery (which walks real article elements), and adds a height-estimation problem for messages whose height depends on streamed content and lazily decoded images. `content-visibility` skips *rendering* work for off-screen subtrees while keeping the elements in the DOM, so anchoring, Ctrl+F, and the existing scroll restore keep working. The failure mode it prevents is the paint-cost cliff on a phone with a long loaded window, without paying the correctness cost virtualization would impose on code the owner already debugged.
    **Caveat, stated because it matters:** `contain-intrinsic-size` guesses wrong for variable-height messages, and a wrong guess moves the scrollbar. Use `contain-intrinsic-size: auto <fallback>` so the browser remembers the last-rendered size, and never apply it to the streaming tail row or to any row above the reader during a prepend.

12. **Claim (recommendation):** Bound tool results at the *model* boundary, not the CSS boundary, and render the bound honestly.
    **Sources:** repo — `src/client/src/components/ToolExecutionView.ts` is imported by `ChatView.ts` (existence direct; its truncation behavior **UNVERIFIED**, I did not read it).
    **Support:** interpretation. **Confidence:** medium.
    **Rationale:** a 10 MB tool output collapsed with CSS still costs parse, DOM, and memory. A bounded projection ("first N KB, M KB hidden, open full output") keeps the transcript's cost proportional to what is readable, and the "M KB hidden" text satisfies the honest-absence rule where a silent clip would not. Check whether `browserMessageProjection.ts` (already imported by the hub, `src/server/daemon/realtime/sessionEventHub.ts`) is the right place to apply the bound once, server-side, so every client and every replay frame agrees.

13. **Claim:** Image loading currently *corrects* scroll after the fact rather than preventing the shift, because attachment images are rendered without intrinsic dimensions and the scroller sets `overflow-anchor: none`.
    **Sources:** `src/client/src/imageLoadScroll.ts` (`imageLoadScrollCorrection`, doc comment: "compensation is by the height the document actually gained, because by the time a load is reported the shift has already happened ... the scroller sets `overflow-anchor: none`").
    **Support:** direct evidence. **Confidence:** high.
    **Recommendation:** persist intrinsic `width`/`height` (or `aspect-ratio`) for attachments so the box is reserved before decode; keep `imageLoadScrollCorrection` as the fallback for images whose dimensions are unknown. **Trade-off:** requires the attachment metadata to carry dimensions (a server/protocol change on `PromptAttachment`), in exchange for removing a whole class of "the page jumped while I was reading" reports at the source instead of compensating for them. This is the "same symptom reported twice stops the patching" rule applied to layout.

### D. Cache invalidation and scope safety

14. **Claim:** Transcript caching is scope-correct today, but only by convention: `ChatTranscriptStore` and `chatHistoryCache` name their parameter `sessionId`, while every call site passes a `machineSessionKey(machineId, sessionId)`.
    **Sources:** `src/client/src/chatHistoryCache.ts` (`function cacheKey(sessionId: string)`), `src/client/src/chatTranscriptStore.ts` (`cachedView(sessionId: string)`, `mergeHistory(sessionId, page)`), `src/client/src/controllers/sessionController.ts` (`const cacheKey = machineSessionKey(machineId, session.id); ... this.transcripts.discard(cacheKey)`; also `saveDraft(machineSessionKey(machineId, forked.id), ...)`), `src/client/src/machineKeys.ts` (`machineSessionKey`, `machineWorkspaceKey`, `machineProjectKey`).
    **Support:** direct evidence. **Confidence:** high.
    **Failure mode:** the type system cannot tell a bare `session.id` from a machine-scoped key. One future call site passing `session.id` would let a remote machine's transcript be read under a colliding local id — precisely the "data must carry the scope it belongs to" violation the owner recorded, and it would ship green.
    **Recommendation (cheap, high leverage):** brand the key. `export type MachineSessionKey = string & { readonly __machineScoped: unique symbol }` returned by `machineSessionKey`, consumed by `ChatTranscriptStore`, `chatHistoryCache`, `promptDraftStorage`, and `pendingOutbox`. Rename the parameters to `sessionKey`. Cost: a mechanical rename plus a cast at the one place the key is parsed back. Benefit: the scope rule becomes a compile error instead of a review convention.

15. **Claim:** Selection-race protection is already explicit and should be the template for anything new: `selectionSeq`, `isSelectedSessionIdentity(sessionId, machineId)`, and `isCurrentSessionSelection(sessionId, machineId, selectionSeq)` gate every late async result before it touches state.
    **Sources:** `src/client/src/controllers/sessionController.ts` (`private selectionSeq = 0;` and the guard calls throughout `navigateTree`, `forkFromTree`, `abortTreeNavigation`), `src/client/src/controllers/sessionRefreshScope.ts` (`refreshMayReplaceSelection`, imported).
    **Support:** direct evidence. **Confidence:** high.
    **Note:** the `sessionStorage` transcript cache is per-tab by definition, which is an accidental scope safety property (no cross-tab bleed) and simultaneously the reason a second tab always pays a cold fetch. If cache-first paint is ever moved to IndexedDB for cross-tab reuse, the branded key from finding 14 becomes mandatory rather than merely advisable.

### E. Network resilience and honest reporting

16. **Claim:** Reconnect/backfill is strong: jittered exponential backoff (500 ms → 5 s, ×1.6, ±50% jitter) to avoid a reconnect stampede after a daemon restart, a foreground liveness check that kills a dead-but-OPEN socket, and `reconnectNow()` on network recovery.
    **Sources:** `src/client/src/sessionSocket.ts` (`jitteredReconnectDelay`, `scheduleReconnect`, `checkLiveness`, `reconnectNow`), `src/client/src/api/transportHealth.ts` (imported as `observeTransportRecovery`, `reportTransportReachable`).
    **Support:** direct evidence. **Confidence:** high.

17. **Claim (the one real exactly-once gap I can see):** user-message delivery is idempotent against *network* failure but I could not verify it is idempotent against a *request timeout*.
    **Sources:** `src/client/src/api/http.ts` (every request gets a deadline; an abort that was ours throws `RequestTimeoutError`), `src/client/src/pendingOutbox.ts` (`isNetworkFailure` matches `NetworkSendError`, fetch `TypeError`s, and connection-refused strings — **it does not match `RequestTimeoutError`**), `src/client/src/messageDelivery.ts` (`restartDelivery` sends a failed bubble back to `sending` reusing the same `clientMessageId`), `src/client/src/controllers/sessionController.ts` (imports `isRequestTimeout` from `../api/requestDeadline`).
    **Support:** direct evidence for the code shapes; **interpretation** for the conclusion. **Confidence:** medium — `sessionController.ts` imports `isRequestTimeout`, so a timeout is clearly handled somewhere in the ~2,300 lines I did not read; I could not confirm what it does to delivery state.
    **The question that must be answered before anything else on this list:** *does the daemon deduplicate an incoming prompt by `clientMessageId`?* If it does, the whole class is closed and a retry is free. If it does not, then a prompt that timed out client-side but landed server-side, followed by a user retry, produces two identical messages in the turn — and the client-side `oneRowPerIdentity` merge in `src/client/src/transcriptInvariant.ts` would *hide* the duplicate in the UI while the model saw it twice. That combination (silent UI merge over a real double-send) is the worst version of this bug, because it is invisible exactly where it matters.
    **Recommendation:** server-side dedup keyed on `(sessionId, clientMessageId)` with a bounded recent-id set, returning the original acceptance for a repeat. That makes retries safe by construction and lets the client treat *any* ambiguous failure (timeout included) as retryable.

18. **Claim:** "Honestly report a lost run" is partly built and partly dark-launched: `ScopeSeqMonitor` counts gaps and logs them, and `SessionGapRepair` repairs them, but the monitor's own doc says gap accounting was originally observe-only.
    **Sources:** `src/client/src/sessionSocket.ts` (`ScopeSeqMonitor` doc: "Gaps are counted and logged, nothing more: acting on them is the next change"; `gapCount` getter; `onGap` callback), `src/client/src/controllers/sessionController.ts` (`gapRepair` is constructed per selection and `onGap` is a required handler in `SessionSocketHandlers`).
    **Support:** direct evidence; the doc comment is **stale relative to the code** (the repair path now exists and `onGap` is required). **Confidence:** high.
    **Recommendation:** delete or correct the stale sentence in the `ScopeSeqMonitor` docstring — a docstring that says "nothing more" beside a wired repair is a review trap. Separately: `gapCount` is exposed but I did not find a surface that renders it; if a repair ever falls back to resync during a live turn, the user is entitled to know the tail was rebuilt rather than streamed.

### F. What is worth it at this scale, and what is not

19. **Worth doing (ordered by value ÷ cost):**
    1. Verify + close the timeout/dedup question (finding 17). Cost: one server-side map plus a test. Prevents: a duplicate prompt reaching the model, hidden by the client's own dedup.
    2. Brand the machine-scoped key (finding 14). Cost: mechanical rename. Prevents: a future cross-machine cache bleed that would pass review.
    3. Intrinsic image dimensions (finding 13). Cost: attachment metadata + template change. Prevents: reading-position jumps at the source.
    4. `content-visibility: auto` on message articles (finding 11). Cost: a few CSS lines + a phone probe. Prevents: paint cliffs on long transcripts without touching anchoring.
    5. Bounded tool-result projection, applied once server-side (finding 12). Cost: one projection function. Prevents: a single huge tool output degrading the whole session.
    6. Honest cached-vs-reconciled marker (finding 3) and the stale docstring fix (finding 18). Cost: trivial. Prevents: retained data reading as current data.

20. **Not worth doing at this scale (each named with what it would actually buy):**
    - **CRDT transcript** — buys multi-writer convergence; there is one writer.
    - **Replicache / Electric / Zero / PowerSync** — buys partial replication and offline multi-write; the offline surface is one composer message, already covered by `pendingOutbox.ts`.
    - **Streaming SSR** — buys cold-start first paint for anonymous visitors on slow links; this is a warm-cache LAN tool with no rendering server.
    - **Virtualized transcript** — buys O(viewport) DOM; costs find-in-page, prepend anchoring, and scroll restore that already work.
    - **Service-worker offline transcript sync** — buys reading history with the daemon down; the daemon being down is the primary thing the user needs told, not hidden.
    - **A second transport (SSE alongside WS)** — buys proxy compatibility; the keepalive + liveness + jittered reconnect trio already handles the proxy failure this repo actually hit (documented in `sessionSocket.ts` and `sessionEventHub.ts`).

---

## Contradictions

- **Stale docstring vs. shipped behavior.** `ScopeSeqMonitor`'s docstring in `src/client/src/sessionSocket.ts` says gaps are "counted and logged, nothing more: acting on them is the next change", while `SessionSocketHandlers.onGap` is a required field and `SessionGapRepair` performs a real replay-and-flush repair. The code is authoritative; the comment is behind it.
- **Parameter naming vs. call-site contract.** `chatHistoryCache.ts` / `chatTranscriptStore.ts` name their key `sessionId`; `sessionController.ts` passes `machineSessionKey(...)`. Both are internally consistent, but the names disagree about what the value is.
- **No external contradiction could be recorded**, because no external source was fetched this run.

## Missing evidence

1. **Daemon-side dedup of `clientMessageId`** — unverified. This is the single decision-critical unknown; everything in finding 17 hinges on it. Check the prompt/send route under `src/server/daemon/` and the sessiond client under `src/server/shared/sessiondClient/`.
2. **What `sessionController.ts` does with `isRequestTimeout`** — unverified; ~2,300 of its lines were unread.
3. **Whether `ChatView.ts` already applies `content-visibility` or any windowing** — unverified negative; ~2,000 of its lines were unread.
4. **Whether `ToolExecutionView.ts` bounds large tool output** — unverified; not read.
5. **Whether `transcriptLoadingOwnership.ts` already renders a cached-vs-reconciled distinction** — unverified; not read.
6. **Every external claim** (SSR trade-offs, `content-visibility` behavior, CRDT and sync-engine positioning, storage quotas, Core Web Vitals thresholds) — recalled, not fetched, not `source_check`ed. No figures are quoted.
7. **No measurements were taken.** There is no INP/LCP/frame-time data for this app in this brief; the rendering recommendations are argued from mechanism and from the code's own recorded incidents, not from a profile of this UI.

## Sources

**Kept — repository (direct evidence, read this run):**
- `src/server/daemon/realtime/sessionEventHub.ts` — the authoritative sequencing, replay ring, keepalive, and socket-buffer bounds.
- `src/client/src/sessionSocket.ts` — liveness, jittered reconnect, seq monitoring, validation-failure-as-gap.
- `src/client/src/sessionGapRepair.ts` — the gap state machine and its resync fallback; the clearest statement of the sync contract in the repo.
- `src/client/src/controllers/sessionController.ts` (partial) — join watermark, selection-race guards, page size, revision scopes.
- `src/client/src/messageDelivery.ts` — the delivery state machine and its monotonicity rules.
- `src/client/src/pendingOutbox.ts` — offline queueing and what counts as a network failure.
- `src/client/src/chatHistoryCache.ts`, `src/client/src/chatTranscriptStore.ts` — local-first first paint and its keying.
- `src/client/src/transcriptInvariant.ts` — client-side identity dedup (relevant to finding 17).
- `src/client/src/imageLoadScroll.ts`, `src/client/src/chatHistoryLoading.ts`, `src/client/src/components/ChatView.ts` (partial) — transcript-scale rendering behavior.
- `src/client/src/machineKeys.ts` — the scope-key vocabulary.
- `AGENTS.md`, `README.md`, `vite.config.ts`, `package.json`, `docs/plugins.md` (partial) — process split, product shape, build shape.

**Pointers only — external, NOT fetched or validated this run (treat as UNVERIFIED):**
- <https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility> , <https://web.dev/articles/content-visibility> — the mechanism behind finding 11.
- <https://web.dev/articles/rendering-on-the-web> , <https://react.dev/reference/react-dom/server> — SSR/streaming background for finding 2.
- <https://crdt.tech/> , <https://automerge.org/> — CRDT background for finding 6.
- <https://replicache.dev/> , <https://electric-sql.com/> , <https://zero.rocicorp.dev/> , <https://www.powersync.com/> — sync-engine positioning for finding 7.
- <https://web.dev/articles/vitals> — INP/LCP definitions, if the follow-up wants measurable targets.

**Rejected/deprioritized:** none evaluated — with no search tool, there was no candidate set to filter. This is a coverage gap, not a judgment.

## Next steps

1. **Read three files and answer finding 17** (highest value): the daemon prompt-send route, `src/client/src/api/requestDeadline.ts`, and the timeout branch in `sessionController.ts`. Decide whether server-side `(sessionId, clientMessageId)` dedup is needed.
2. **Read `ChatView.ts` end to end and `ToolExecutionView.ts`** to convert findings 10 and 12 from medium to high confidence before writing any CSS or projection code.
3. **Re-run this brief's external half with search enabled**, targeting: `content-visibility` correctness caveats with dynamic content; published engineering write-ups on chat transcript virtualization vs. containment; whether any sync-engine vendor publishes a single-writer/append-only guidance note that would contradict finding 7.
4. **Measure before optimizing rendering**: a `scripts/probe-*.mjs` run at coarse-pointer 393×850 against the 8505 stack on a session with several thousand messages, recording long-task counts and scroll frame times. Findings 11 and 12 should be justified by that number, not by this brief.
