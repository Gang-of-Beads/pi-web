# PI WEB × stablyai/orca — Cache / Lazy-load / Prefetch / Perceived-performance parity review

Reviewed: 2026-09-09 (local clock)
- Orca clone: `/tmp/orca-study-cache` (referenced below as `orca:` = `<path>` relative to that root)
- PI WEB: `/Users/hanxiao.du/Desktop/vincent/projects/pi-web` (referenced below as `pi:` = `<path>` relative to that root)

Scope requested: compare orca's caching, lazy loading, prefetching and perceived-performance techniques against PI WEB; state whether each is borrowable, at what cost, and how large a change it implies.

---

## 0. Executive summary

**PI WEB is already strong where orca is weak.** PI WEB's streaming pipeline is more carefully engineered than orca's: incremental append-only markdown (`pi:src/client/src/components/formattedText.ts:39-52`), incremental message grouping (`pi:src/client/src/components/ChatView.ts:1271-1276`), trailing-refresh coalescing (`pi:src/client/src/controllers/trailingRefreshCoordinator.ts:15-65`), gap repair with sequence replay (`pi:src/client/src/controllers/sessionController.ts:356-379`), and an explicit three-state transcript view (loading / empty / failed — `pi:src/client/src/components/ChatView.ts:1650-1662`). Orca has no equivalent of the last two.

**PI WEB's gaps are all in the *network and first-paint* layer, not the render layer.** Concretely: zero stale-while-revalidate on session switching, zero in-flight request dedupe in the API layer, zero hover prefetch, zero route-level code splitting (a single 1,016,264-byte `index-*.js` chunk), a client transcript cache that is silently dead for large sessions, and no input-priority gating.

**The 5 highest-value borrows**, by impact ÷ effort:

| # | Finding | Orca source | Est. effort |
|---|---|---|---|
| 1 | Stale-while-revalidate for session switching | `src/renderer/src/store/slices/hosted-review.ts:305-315` | ~1 day |
| 2 | Byte-budgeted transcript cache with eviction (current cache is dead for big sessions) | `src/main/native-chat/transcript-read-cache.ts:39-47` | ~0.5 day |
| 3 | Generic in-flight GET dedupe | `src/shared/in-flight-promise-dedupe.ts` (whole file, 83 lines) | ~0.5 day |
| 4 | Hover/focus prefetch on session rows | `src/renderer/src/components/sidebar/SidebarTaskNavButton.tsx:164` | ~0.5 day |
| 5 | Route/feature code splitting + chunk-load retry | `src/renderer/src/lib/lazy-with-retry.ts:253`, ~158 call sites | 3-5 days |

**One finding is a bug, not a design choice:** `pi:src/client/src/chatHistoryCache.ts:30-35` swallows `QuotaExceededError` with no eviction, so any transcript page large enough to exceed the ~5MB sessionStorage budget is never cached at all — and large transcripts are exactly the ones where caching matters. See Finding 2.

---

## 1. Capability matrix

| Capability | Orca | PI WEB | Gap severity |
|---|---|---|---|
| Stale-while-revalidate (serve cache, refetch in background, keyed by request) | Yes — `hosted-review.ts:305-315`, `hosted-review-cache-state.ts:188` | Partial — in-memory list seeding only (`pi:src/client/src/workspaceSessionsCache.ts`) | **High** |
| Cache freshness predicate (`isFresh` + TTL) | Yes — `cache-policy.ts:3-15` (300 s / 60 s) | Only a 30-min wall-clock TTL in the sessionStorage layer (`pi:src/client/src/chatHistoryCache.ts:2`) | **High** |
| In-flight promise dedupe (generic) | Yes — `in-flight-promise-dedupe.ts:13-79`, used by `request-coordination.ts:26-31` | Ad-hoc, server-side only (`pi:src/server/shared/projects/directorySuggestions.ts:168-195`); client has none | **High** |
| Byte-budgeted LRU cache | Yes — `transcript-read-cache.ts:39-47` (50 entries / 128 MB), `cold-restore-payload-cache.ts:14` (16 MB), `local-image-src-cache.ts:9-11` | Count-only LRU (`pi:src/client/src/chatTranscriptStore.ts:14`, 12 items); sessionStorage layer has no eviction | **High** |
| Hover / focus prefetch | Yes — `SidebarTaskNavButton.tsx:164`, `WorktreeCardMeta.tsx:191`, `preloadCommentMarkdown` | None — `pi:src/client/src/components/SessionList.ts:380` has only `@click`/`@keydown` | **Medium** |
| Request concurrency cap | Yes — `request-coordination.ts:53` (`PROVIDER_REQUEST_CONCURRENCY = 8`) | None — unbounded fan-out | **Medium** |
| Visibility-paused polling | Yes — `window-visibility-interval.ts:6-30` | Yes — `pi:src/client/src/sessionActivityPolling.ts` (`documentVisible` gate) | parity |
| Thundering-herd jitter on tab refocus | Yes — `window-visibility-interval.ts:4` (400 ms jitter) | None — `pi:src/client/src/appShell/browserResumeController.ts:69-76` refreshes synchronously on every visible signal | **Medium** |
| Input-quiet gating for heavy publishes | Yes — `input-quiet-scheduler.ts:28-101`, `ai-vault-session-publication-gate.ts` (100 ms quiet, 1 s cap) | rAF coalescing only; no input-quiet gate | **Medium** |
| Lazy chunk loading with retry/reload recovery | Yes — `lazy-with-retry.ts:34-258`, ~158 call sites | 2 dynamic imports total (`pi:src/client/src/components/PromptEditor.ts:792`, `pi:src/client/src/plugins/external.ts:77`) | **High** |
| Skeleton placeholder while loading | Partial — only 2 skeletons in the whole app | Text-only "Loading this session…" (`pi:src/client/src/components/ChatView.ts:1650-1657`) | Low |
| Transcript virtualization | Yes for worktree list (`@tanstack/react-virtual`, `worktree-list/viewport/`); **not** for native chat | None — Lit `repeat()` over all groups (`pi:src/client/src/components/ChatView.ts:996`) | Low (see §5) |
| `content-visibility: auto` | Not used | Used once — `pi:src/client/src/components/SessionTreeNavigator.ts:551` | PI WEB ahead |
| Scroll-anchor restore under re-key/re-measure | Yes — `virtualized-scroll-anchor-restore.ts:35+` (multi-strategy convergence loop) | Yes — `pi:src/client/src/readingAnchor.ts`, `imageLoadScrollCorrection` | parity, PI WEB simpler |
| Incremental tail-append fast path | Yes — `native-chat-incremental-assembler.ts:74,90` | Yes — `pi:src/client/src/components/ChatView.ts:1271-1276`, `formattedText.ts:39` | parity |
| Error preservation on background revalidation failure | Yes — `hosted-review.ts:270-283` keeps last good entry | Yes for lists (`rememberWorkspaceSessions`) — `sessionController.ts:946`; no equivalent elsewhere | Low |
| Server-side parsed-session cache across daemon restarts | Yes — `session-parse-cache-store.ts:10-96` + `session-parse-cache-persistence.ts:18` (schema-versioned, byte-offset resume points) | Sessions stay open in memory (`piSessionService.ts:2367`); nothing survives restart | Low |
| Optimistic UI | ~20 sites | Intentionally avoided — see `pi:docs/design/operation-model.md`; one optimistic bubble path (`pi:src/server/daemon/sessions/piSessionService.ts:2853`) | parity by design |

---

## 2. Findings, ranked by value to PI WEB

### Finding 1 — Stale-while-revalidate on session switching (HIGH value, LOW cost) — **borrow**

**Orca.** `src/renderer/src/store/slices/hosted-review.ts:305-315`:
```
if (!force && !linkedRefetch &&
    options?.staleWhileRevalidate && cached !== undefined && cached.data !== null) {
  queueHostedReviewRevalidation(requestKey, startRequest, inflightRequest)
  return cached.data          // render the stale value NOW
}
```
The caller never blocks. The revalidation is queued, deduped, and its outcome is merged on arrival. Two supporting guards make it safe: `queueHostedReviewRevalidation` (`hosted-review-cache-state.ts`) dedupes the background pass by request key, and `hosted-review.ts:270-283` keeps the previous entry on failure rather than blanking the UI. The consumer side is `use-worktree-card-lifecycle-effects.ts`, which sets `staleWhileRevalidate: true` for *visible* cards only — off-screen rows do not trigger network at all.

**PI WEB.** `pi:src/client/src/controllers/sessionController.ts:298` reads `this.transcripts.cachedView(transcriptKey)` and spreads the cached messages into state, but line 326 then sets `isLoadingTranscript: true`, and `ChatView.ts:1650-1657` only shows the placeholder when `messages.length === 0`. So the "serve-then-refresh" shape is *almost* there — but it is ad hoc, has no freshness bound, and it does not exist at all for the *session list*. `refreshCurrentWorkspaceSessions` (`sessionController.ts:937-947`) always awaits `this.api.sessions(...)` before calling `setState`, so a workspace switch repaints only when the daemon answers. `workspaceSessionsCache.ts` already holds the previous list, but the *rendering* path still waits.

**Adaptation for PI WEB.** Add one pure helper, `shouldServeStale(entry, ttlMs) -> boolean`, modelled on `orca:src/renderer/src/store/github/cache-policy.ts:9-15`, plus one `queueBackgroundRevalidation(key, fn)` map. Then:
- `sessionController.selectSession`: keep the cached-view spread, and mark `transcriptStale: true` instead of `isLoadingTranscript: true` when a cached page exists. The refresh becomes background work; the transcript is interactive immediately.
- `refreshCurrentWorkspaceSessions`: render `cachedSessionsFor(machineId, path)` first, refresh in the background, then `setState`.
The daemon is a loopback socket on the same machine, so staleness windows can be short (60 s, matching orca's `WORK_ITEMS_CACHE_TTL`, `cache-policy.ts:4`) with no user-visible risk.

**Cost.** ~150 lines across 3 files + tests. No protocol or server change. **Risk: low** — PI WEB already has the state machine for "cached data plus in-flight refresh"; it needs a freshness bound, not new architecture.

**Do not borrow:** orca's three admission tiers (`'interactive' | 'status' | 'background'`). They exist because orca multiplexes many concurrent `gh` CLI subprocesses; PI WEB's daemon answers from memory. Tiering adds a scheduler to test for no measured win. Skip until PI WEB has a slow I/O path.

---

### Finding 2 — The client transcript cache is silently dead for large sessions (HIGH value, VERY LOW cost) — **fix, and borrow the budget model**

**PI WEB (the bug).** `pi:src/client/src/chatHistoryCache.ts:30-35`:
```ts
export function writeChatHistoryCache(sessionId: string, page: RawMessagePage): void {
  try {
    sessionStorage.setItem(cacheKey(sessionId), JSON.stringify({ savedAt: Date.now(), page }));
  } catch {
  }
}
```
`sessionStorage` budgets are ~5 MB per origin. A 100-message page containing tool output routinely exceeds that. When it does, `setItem` throws `QuotaExceededError`, the `catch {}` discards it, and **nothing is ever cached for that session** — the exact sessions a reader revisits. There is no eviction, so a single oversized write also poisons later small writes for other sessions until something else frees space. Reads are correctly guarded (`chatHistoryCache.ts:14-28` with a 30-min TTL), so the failure is invisible: no error, no log, just a cache that never hits.

**Orca.** Three separate caches, all with the same shape — a **byte budget, not an item budget, plus real eviction**:
- `src/main/native-chat/transcript-read-cache.ts:39-47`: `MAX_CACHE_ENTRIES = 50`, `MAX_CACHE_BYTES = 128 * 1024 * 1024`, invalidated by `mtimeMs`/`size`.
- `src/main/daemon/cold-restore-payload-cache.ts:14-27`: `MAX_COLD_RESTORE_CACHE_BYTES = 16 MB`, `getColdRestorePayloadBytes` estimates via string length, LRU eviction by Map insertion-order manipulation.
- `src/renderer/src/components/editor/local-image-src-cache.ts:9-11,94-118`: entry cap **and** byte cap, plus **pinning** (`while (projectedEntries > MAX || projectedBytes > MAX)` skips pinned entries) and a generation counter so consumers can detect invalidation.

**Adaptation.** Two changes, both small:
1. `writeChatHistoryCache`: on `QuotaExceededError`, evict least-recently-used `pi-chat-history:*` keys until the write succeeds, then retry once. Track a `savedAt`-ordered key list (or a parallel index key — `sessionStorage` gives no iteration order guarantee you can rely on for LRU semantics). This alone revives the cache.
2. Replace the count-based `MAX_IN_MEMORY_TRANSCRIPTS = 12` (`pi:src/client/src/chatTranscriptStore.ts:14,82-90`) with a byte budget, using orca's `getColdRestorePayloadBytes` estimate (serialized length). Twelve 2 MB tool-output-heavy pages is 24 MB of retained JSON; twelve short chat pages is 200 KB. The count bound is the wrong unit for both cases — it evicts too eagerly in one and retains too much in the other.

**Cost.** ~60 lines + tests. **Risk: very low**, entirely local to two modules with existing test files (`pi:src/client/src/chatHistoryCache.ts` has read/write guards already tested).

**Do not borrow:** orca's `mtimeMs`/`size` invalidation (`transcript-read-cache.ts`). PI WEB has revisions already — `pi:src/client/src/revisionScope.ts` — and a client-side cache cannot see the file's mtime. Cache invalidation should key off revision, which PI WEB already threads.

---

### Finding 3 — Generic in-flight GET dedupe in the API layer (HIGH value, VERY LOW cost) — **borrow near-verbatim**

**Orca.** `src/shared/in-flight-promise-dedupe.ts` (83 lines, zero framework imports) exposes `InFlightPromiseDedupe<T>`: key → shared promise, `MAX_IN_FLIGHT_PROMISE_DEDUPE_ENTRIES = 128` and `MAX_IN_FLIGHT_PROMISE_DEDUPE_KEY_CODE_UNITS = 64 * 1024` so a churning key set cannot leak the map, a 30 s safety timeout, and — importantly — **overflow bypass**: when the map is full it does not evict an in-flight entry, it just runs the call un-deduped. `stableInFlightKey(parts)` (line 81) canonicalizes key parts so callers cannot accidentally create two keys for one request.

The escalation guard at `src/renderer/src/store/github/work-item-fetch-actions.ts:112-124` is the part worth reading twice:
```
if ((options?.force && !existing.force) || (options?.noCache && !existing.noCache) || ...) {
  await existing.promise.catch(() => {})   // don't dedupe a strict caller onto a weak in-flight fetch
} else { return existing.promise }
```

**PI WEB.** `pi:src/client/src/api/http.ts` is 52 lines: deadline plumbing over `fetchWithDeadline` and `HttpError`. No dedupe. PI WEB *does* solve this for one caller (`pi:src/server/shared/projects/directorySuggestions.ts:168-195`, `inFlightReads` Map) and for refresh loops (`TrailingRefreshCoordinator`, `pi:src/client/src/controllers/trailingRefreshCoordinator.ts:15`), which proves the idiom is at home here — but `TrailingRefreshCoordinator.request()` returns `Promise<void>` and takes a *closure*, so it cannot share a value-returning GET between two independent callers. Concretely, `sessionController.ts:1474-1478` fires `messages` + `status` + `streamSnapshot` in `Promise.all`, and `browserResumeController` (`pi:src/client/src/appShell/browserResumeController.ts:69-76`) can fire the whole selection refresh a second time in the same tick as a focus event landing alongside a route change.

**Adaptation.** Port `InFlightPromiseDedupe` unchanged (it is TypeScript with no React dependency) and wrap the idempotent GETs in `pi:src/client/src/api/`: `sessions()`, `workspaces()`, `machines()`, `plugins()`, `status()`. Keep mutations and `sendPrompt` outside it. Add the `force` escalation flag from the orca snippet — PI WEB has the same hazard: a forced user-initiated refresh must not collapse onto an ambient in-flight fetch.

**Cost.** ~85 lines new module + a one-line wrapper per GET. **Risk: low.** One caveat: the 30 s safety timeout must be at least as long as PI WEB's existing request deadlines, or dedupe will mask a slow endpoint as a timeout.

---

### Finding 4 — Hover/focus prefetch on session rows (HIGH perceived value, VERY LOW cost) — **borrow**

**Orca.** `src/renderer/src/components/sidebar/SidebarTaskNavButton.tsx:164-165`:
```tsx
onClick={() => openTaskPage()}
onPointerEnter={handlePrefetch}
onFocus={handlePrefetch}
```
`handlePrefetch` calls `prefetchWorkItems(...)` (`src/renderer/src/store/github/work-item-aggregate-actions.ts:232`), which is guarded by `isFresh` and an in-flight check, so a hover over ten rows in two seconds costs one request. Same idiom at `src/renderer/src/components/sidebar/WorktreeCardMeta.tsx:191` (`onPointerEnter={hasComment(comment) ? preloadCommentMarkdown : undefined}`) — expensive derived work is triggered by intent, not by click.

**PI WEB.** `pi:src/client/src/components/SessionList.ts:380` (`renderSession`) binds `@click` and keyboard handlers and nothing pointer-related. A click on a row starts the transcript fetch from zero; the reader waits the full round trip staring at "Loading this session…" (`ChatView.ts:1652-1657`). The data to prefetch is the *exact* thing the click will need: `api.messages(session, { limit: 100 }, machineId)` (`sessionController.ts:38` sets `MESSAGE_PAGE_SIZE = 100`).

**Adaptation.** Add `@pointerenter=${() => this.prefetchSession(session)}` (and `@focus`) to the row. The handler calls a fire-and-forget `void this.api.messages(...)` whose only side effect is `transcripts.mergeHistory(...)` — the result lands in the LRU and sessionStorage; nothing renders. When the real click arrives, `cachedView(transcriptKey)` at `sessionController.ts:298` hits and Finding 1 serves it instantly. Guard with a `Set<string>` of in-flight/prefetched keys so repeated hovers cost nothing, and gate on `documentVisible` (already available via `sessionActivityPolling`).

**Cost.** ~40 lines. **Risk: low.** The one thing to measure: on touch devices `pointerenter` fires on tap, which is the click itself, so the prefetch saves nothing and costs a duplicate request — hence the dedupe guard is not optional. Better on mobile: prefetch on the row's `@pointerdown`, which fires ~80-150 ms before `click` on touch.

**Second, larger application of the same idea:** orca prefetches an entire target view, not just a row. The same would pay off on the workspace list (hovering a workspace prefetches `api.sessions(path)`) and on the sidebar machine switcher. PI WEB's session lists are cheap loopback calls, so this is safe to do liberally.

---

### Finding 5 — Route/feature code splitting; the entry bundle is 991 KB (HIGH value, HIGH cost) — **borrow with adaptation**

**PI WEB today.** `dist/client/assets/index-Bbw1inG1.js` = **1,016,264 bytes**, plus `vendor-editor-core` (320,547 B) and `vendor-editor-languages` (181,526 B). Total `dist/client` ≈ 1.5 MB, and every byte of it is required before first paint: `dist/client/index.html` has exactly **one** `<script type="module">` and **zero** `<link rel="modulepreload">`. `pi:vite.config.ts:109-117` returns `undefined` from `manualChunks` for every non-`node_modules` module, so all app code collapses into the one chunk. `pi:src/client/src/components/PiWebApp.ts` is 4,003 lines with 97 static imports in a single component class, so every import it needs is a first-paint import. Across the whole client there are exactly **2** dynamic `import()`: `PromptEditor.ts:792` (CodeMirror setup) and `plugins/external.ts:77` (user plugins).

**Orca.** `src/renderer/src/lib/lazy-with-retry.ts:253` (`lazyWithRetry`) wraps `React.lazy` with: exponential-backoff retry (`DEFAULT_RETRIES = 2`, `DEFAULT_BASE_DELAY_MS = 250`, line 56), a `LazyChunkLoadError` class (line 34) so the UI can distinguish a failed chunk from a failed render, one document-level reload recovery guarded by `sessionStorage` (`RELOAD_GUARD_KEY = 'orca:lazy-chunk-reload-attempted'`) and `MAX_RELOAD_REQUESTS_PER_DOCUMENT = 2` (line 100) so a bad deploy cannot produce a reload loop. It is used at ~158 call sites: sidebar, right panel, editor, settings, dialogs.

**Adaptation — this does NOT port directly.** PI WEB is Lit, not React: there is no `Suspense` boundary to fall back to. The Lit-native shape is:
1. Keep a small core shell eager (router, session list, chat frame).
2. Convert heavy leaves to `customElements.define` inside a dynamic `import()` at the point of first need, and render a lightweight placeholder in the interim. Candidates by size and by the fact that they are not needed at first paint: the terminal (`@xterm`, already its own `vendor-terminal` chunk per `vite.config.ts:115`), the file/tree editors, `ToolExecutionView` output renderers, image-zoom modal, settings, plugins.
3. Make the manualChunks function split app code by *component directory* rather than returning `undefined`.
4. Port the retry/reload-guard logic. Lines 34-120 of `lazy-with-retry.ts` are framework-agnostic and drop in as-is; only line 253's `React.lazy` wrapper needs a Lit equivalent. Vite already emits `<link rel="modulepreload">` for static import graph edges, so splitting also fixes the "zero modulepreload" observation — no extra work.
5. `pi:src/server/web/app.ts:373` already serves `/assets/` as `public, max-age=31536000, immutable` (same as orca's `static-web-client-handler.ts:74-75`), so split chunks are cached correctly from day one. The deployment risk that reload-guards defend against — a hashed chunk 404'ing after an upgrade — applies identically here.

**Cost.** 3-5 days: chunk-boundary audit, moving component registration behind dynamic imports without breaking `customElements` resolution order, and regression tests for the deferred-registration path. **Risk: medium** — Lit custom-element registration is global and order-sensitive; a component imported lazily can appear as an unknown element in a render pass. Mitigate with a placeholder element rather than conditional rendering.

**This is the only finding whose cost is genuinely large.** It is also the only one that affects *first paint for every user on every load* rather than a specific interaction, which is why it stays ranked here despite the cost. If capacity is short, do Findings 1-4 first and split only the terminal + editor (the two biggest non-first-paint payloads) as a scoped first slice.

---

### Finding 6 — Input-quiet gating for expensive state publishes (MEDIUM-HIGH value, LOW cost) — **borrow**

**Orca.** `src/renderer/src/lib/input-quiet-scheduler.ts:28-101` tracks `keydown`, `pointerdown`, `pointermove`, `pointerup`, `touchstart`, `wheel` (capture, passive) and exports `hasInputBeenQuietFor(quietMs)` and `scheduleAfterInputQuiet(...)`, which uses `requestIdleCallback` with a timeout fallback. `src/renderer/src/components/right-sidebar/ai-vault-session-publication-gate.ts` applies it: `AI_VAULT_PUBLICATION_QUIET_MS = 100`, `MAX_WAIT_MS = 1000`, a generation counter to cancel stale publishes, and the state write wrapped in `startTransition`. Net effect: a session-list refresh that lands while the user is mid-scroll or mid-keystroke waits up to 1 s instead of landing a large DOM diff into the middle of a gesture.

**PI WEB.** `pi:src/client/src/components/ChatView.ts:991` attaches `@scroll`, `@wheel`, `@touchstart`, `@touchmove`, `@pointerdown`, `@pointerup` handlers — the exact input set orca tracks — but uses them only for scroll pinning and press state. Streaming updates are coalesced by frame (`pi:src/client/src/controllers/sessionController.ts:291` → `clearPendingUpdates()` / `flushPendingUpdates()`), which is *frame* coalescing, not *input-quiet* deferral. A large `refreshSelectedSession` result (`sessionController.ts:1487-1493`, which replaces the whole message array) landing during an inertial scroll is the one case where PI WEB will visibly jump.

**Adaptation.** A ~50-line `inputQuietScheduler` mirroring orca's, and use it at the two or three sites that publish *whole-list* replacements: `requestSelectedSessionRefresh`'s `setState` (`sessionController.ts:1487`), `refreshCurrentWorkspaceSessions`'s `setState` (`:947`), and the `browserResumeController` refresh (`browserResumeController.ts:69-76`). Critically — keep *streaming deltas* ungated. Deferring an `assistant.delta` behind a 100 ms quiet window makes typing look laggy; only bulk replaces should wait. Orca makes the same distinction, which is why the gate wraps only the publication path, not the message path.

**Cost.** ~80 lines + tests. **Risk: low,** but the cap is load-bearing — without `MAX_WAIT_MS` a continuously-scrolling user starves the refresh indefinitely and sees stale data with no explanation.

---

### Finding 7 — Provider request concurrency semaphore (MEDIUM value, LOW cost) — **borrow, scaled down**

**Orca.** `src/renderer/src/store/github/request-coordination.ts:53-70`: `PROVIDER_REQUEST_CONCURRENCY = 8` with a promise-queue semaphore (`acquireProviderRequestSlot` / `releaseProviderRequestSlot`) that blocks the caller at capacity and dequeues the next waiter on release. Every work-item fetch awaits a slot before doing work (`work-item-fetch-actions.ts:127`).

**PI WEB.** No cap anywhere in the client. Concrete unbounded fan-out: `PiWebApp.ts:2440` does `workspaceLists.flat()` and `:2453` does `sessionLists.flat()` — multi-workspace listing and multi-workspace session listing, fanned out across every workspace at once. With 20 workspaces that is 20 concurrent daemon round-trips the instant the machine changes, on top of the visibility-resume refresh that likely triggered it (`browserResumeController.ts:69-76`). Same for plugin manifest fetches, which `pi:src/client/src/plugins/external.ts` fires via `Promise.allSettled` over every plugin.

**Adaptation.** Port the semaphore verbatim (framework-agnostic, ~30 lines) and apply it at exactly two call sites: multi-workspace listing/session listing, and plugin manifest fetch. **Cap of 8 is wrong for loopback** — PI WEB's daemon is local, so the constraint is daemon event-loop pressure and browser per-host connection limits, not provider rate limits. Start at 6, measure, likely never touch again.

**Cost.** ~40 lines. **Risk: very low.**

---

### Finding 8 — Jitter on visibility resume (MEDIUM value, VERY LOW cost) — **borrow**

**Orca.** `src/renderer/src/lib/window-visibility-interval.ts:4` — `MAX_VISIBILITY_JITTER_MS = 400`. When a tab becomes visible, the interval does not fire immediately: it applies a random delay up to 400 ms. `runOnVisible` similarly defers evidence-bearing refreshes. `isWindowVisible()` gates every tick so hidden tabs cost nothing.

**PI WEB.** The visibility gate is already correct — `pi:src/client/src/sessionActivityPolling.ts` (`shouldPollSessionActivity({ hasSelectedSession, documentVisible })`) and `pi:src/client/src/appShell/browserResumeController.ts:60-62` (`onVisibilityChange` → `handleResumeSignal`). The gap is *what happens on resume*: `handleResumeSignal` schedules a frame and immediately issues `refreshAfterResume()`, which for a multi-workspace setup is the Finding 7 fan-out. Refocus a tab with N windows open and all N fire simultaneously.

**Adaptation.** In `BrowserResumeController.handleResumeSignal`, apply a random 0-400 ms delay before the refresh, and — better — inject the jitter source through the existing `BrowserResumeControllerOptions` (`browserResumeController.ts:17-22`), which already takes injected `scheduleFrame` and `isDocumentVisible` seams and is therefore already trivially testable.

**Cost.** ~10 lines + 1 test. **Risk: negligible.** Value is modest in isolation; it compounds with Findings 4 and 7 because all three reduce the same refocus burst.

---

### Finding 9 — Lazy-load failure recovery (MEDIUM value today, HIGH once Finding 5 lands, VERY LOW cost)

**Orca.** `src/renderer/src/lib/lazy-with-retry.ts:34-120`. Beyond retry: `LazyChunkLoadError` (line 34) is a typed error so the *rendering* layer can offer a distinct "this panel failed to load, retry" affordance instead of a blank region; and the reload recovery is bounded per document by `MAX_RELOAD_REQUESTS_PER_DOCUMENT = 2` with a `sessionStorage` marker, so a stale `index.html` pointing at garbage-hashed chunks recovers once and then degrades to a visible error instead of looping.

**PI WEB.** `pi:src/client/src/plugins/external.ts:77` does `import(/* @vite-ignore */ moduleUrl)` inside `Promise.allSettled` with error collection — reasonable, but there is **no retry**. A plugin chunk that fails on a flaky network is simply absent until reload, and `fetchPluginManifest` uses `cache: "no-store"`, so nothing is recoverable from HTTP cache either. After Finding 5 splits the bundle, this gap widens to the whole app.

**Adaptation.** Take lines 34-120 of `lazy-with-retry.ts` (retry + exponential backoff + reload guard) as a standalone `lazyWithRetry` module usable by both the plugin loader and the post-Finding-5 chunk loader. Do **not** take orca's React-specific wrapper at line 253.

**Cost.** ~100 lines. **Risk: low.** Note the deploy-staleness scenario is real for PI WEB: `app.ts:388` serves `index.html` and hashed assets live under the immutable cache header, so after an upgrade a long-lived tab can request a chunk that no longer exists.

---

### Finding 10 — Server-side parsed-session cache with byte-offset resume (LOW-MEDIUM value, HIGH cost) — **study, do not port yet**

**Orca.** Two layers:
- `src/main/native-chat/transcript-read-cache.ts` — parsed transcript trees keyed by path, invalidated by `mtimeMs` + size, 50 entries / 128 MB, **shared across all connected clients** (process-global), so N clients reading one session cost one parse.
- `src/main/ai-vault/session-parse-cache-store.ts:10-96` + `session-parse-cache-persistence.ts:18` — the parse cache is *persisted across daemon restarts*, schema-versioned (`SCHEMA_VERSION = 2`, with an `appVersion` compatibility check at line 146), and carries `SessionParseResumePoint { byteOffset, ... }` (line 10-18) so an unchanged file resumes parsing from the last byte offset instead of re-reading. Seeded entries get `resume: null` (line 68-71): after restart, a changed file restarts from zero.

**PI WEB.** `pi:src/server/daemon/sessions/piSessionService.ts:2367` (`messages()`) calls `historyMessages(session)` on an already-open in-memory session via `getOrOpen()` — no disk re-read per request, so the common path is already fast. What PI WEB lacks is (a) cost on a *cold* open after daemon restart, and (b) an mtime fast path for "nothing changed since the last read".

**Verdict.** Orca's cache exists because orca parses third-party JSONL (Claude/Codex) from disk for sessions it does not own. PI WEB owns its sessions and keeps them open, so most of the win is already captured. **Revisit if** cold daemon start with large sessions shows up in startup traces, or if PI WEB grows third-party session import. Also note PI WEB has the right invalidation primitive already — `pi:src/server/daemon/sessions/sessionFileHeader.ts:23` documents treating the file as immutable per path, which is the stronger assumption that would make a byte-offset resume cache tractable here.

---

### Finding 11 — Transcript virtualization: orca's own choice validates PI WEB (LOW value) — **do not borrow**

**Orca virtualizes the worktree list** (`src/renderer/src/components/sidebar/worktree-list/viewport/VirtualizedWorktreeViewport.tsx`, `use-virtualizer.ts`, `use-row-measurement.ts`, `virtual-rows.ts`, on `@tanstack/react-virtual` `^3.14.10`) — rows of uniform, known height, potentially thousands. **Orca does not virtualize native chat** (`NativeChatMessageList.tsx` renders ordinary rows, with `memo` on `NativeChatMessageRow.tsx:34` and eleven `useMemo` projections in the list at lines 73-141). That is a considered decision: chat rows have wildly variable heights, expanded `<details>`, lazy images, and code blocks, so virtualization costs scroll-anchor correctness for a modest paint win.

The anchor machinery orca needed is the argument against it: `src/renderer/src/hooks/virtualized-scroll-anchor-restore.ts:35-168` is 168 lines of *multi-strategy convergence loop* — a re-measure/re-anchor pass that iterates until the reader's position is actually restored, because a virtualized list's estimate and its measured heights disagree.

**PI WEB already gets most of the paint win for free.** Lit's `repeat()` keyed rendering (`pi:src/client/src/components/ChatView.ts:996`, `1434`, `1545`) does not re-templating unchanged groups, the append-only grouping fast path (`ChatView.ts:1271-1276`) keeps prefix group objects identical, and `FormattedText.ts:39-52` reuses the last committed parse. Images are `loading="lazy"` (`ChatView.ts:1956`) with `imageLoadScrollCorrection` handling the reflow they cause. And PI WEB already applies `content-visibility: auto` + `contain-intrinsic-block-size` where rows are uniform — `pi:src/client/src/components/SessionTreeNavigator.ts:551` — which is exactly the worktree-list case orca built a virtualizer for.

**Cheap middle path if long transcripts ever measure badly:** extend the `content-visibility: auto` pattern from `SessionTreeNavigator.ts:551` to chat message rows. That yields render skipping for off-screen content with none of the anchor math, at the cost of imprecise scrollbar geometry. PI WEB's `readingAnchorDecision()` (`pi:src/client/src/readingAnchor.ts`, returning `prepend | hold | follow-tail`) is well designed but only handles append/prepend — a virtualized list can evict rows from the *middle* on scroll-back, a fourth state it does not model. That is the concrete reason virtualization would enlarge PI WEB's riskiest code, not just add a dependency.

---

### Finding 12 — Skeleton placeholders (LOW value, LOW cost) — **optional**

Orca has exactly two skeletons in the entire app (`ArtifactsPageSkeleton`, `AutomationsPageSkeleton`), so this is not a place orca is strong. But PI WEB is weaker: `renderEmptySession` (`pi:src/client/src/components/ChatView.ts:1650-1657`) renders a single `<p>Loading this session…</p>`, and the code comment at lines 1636-1640 shows the team already hit the layout-collapse problem once (1160 px of blank screen). A 6-8 block shimmer placeholder at approximately correct message heights would (a) stop the layout collapse, and (b) communicate volume, which a text line does not.

Directly relevant once Finding 1 lands: with stale-while-revalidate, the loading state appears far less often, which reduces how much skeletons matter — so **do Finding 1 first and re-evaluate**. `renderHistoryBoundary` (`ChatView.ts:1622-1631`) is the better first target: scroll-up-triggered "Loading earlier messages…" replaces real content and shifts the anchor; that path already has `readingAnchorDecision() → prepend` handling it, so a placeholder there is about smoothness rather than correctness.

---

### Finding 13 — Per-client/per-user cache scoping (LOW value) — **note for the roadmap**

Orca keys caches to include the target/host scope so two accounts or two repos cannot collide: `getGitHubWorkItemSourceCacheScope(...)` feeds `workItemsCacheKey(repoId, limit, query, cacheScope)` (`work-item-fetch-actions.ts:96-97`), and `request-coordination.ts` uses a *separate* in-flight Map per resource family (work items, PRs, PR check details, comments, project views) rather than one shared key-space.

PI WEB already handles the multi-machine case correctly — `sessionCacheKey` uses `machineSessionKey(selectedMachineId(state), sessionId)`, and `workspaceSessionsCache.ts:15-18` keys on `${machineId}\0${workspacePath}` with an explicit comment explaining why ("Two machines can list the same path"). **PI WEB is at parity here.** The forward-looking note: when PI WEB adds multi-user or per-token caching, adopt orca's rule — the cache key carries every dimension the fetch actually varied on — rather than retrofitting.

---

## 3. Things PI WEB does better (do not regress these while borrowing)

1. **Streaming markdown append-only parsing.** `pi:src/client/src/components/formattedText.ts:36-52` keeps the last committed parse and renders only the delta suffix in a `<span class="stream-suffix">`, deferring the full re-parse to a settle timer (`scheduleSettleParse`, line 63). Orca's `native-chat-prose.ts` has no render cache at all — its perf suite (`NativeChatMessageList.stream-render.perf.test.tsx:14-24`) exists specifically to *police* how many times `nativeChatProseToMarkdown` runs per stream delta. PI WEB solved structurally what orca guards with tests.
2. **Explicit three-state transcript view.** Loading / empty / failed are separate render paths (`ChatView.ts:1650-1662`), with a comment explaining that a failed read must never claim emptiness. Orca's `readPhase: 'loading' | 'ready'` (`use-native-chat-retained-session.ts:28-54`) has no third state.
3. **Sequence-numbered gap repair.** `sessionController.ts:356-379` buffers socket frames, replays the missed range via `streamSync`, and falls back to full refresh on a resync verdict. Orca's nearest equivalent is plain refetch.
4. **`content-visibility: auto` on uniform rows** (`SessionTreeNavigator.ts:551`) — orca uses no `content-visibility` anywhere in its CSS.
5. **`TrailingRefreshCoordinator`** (`pi:src/client/src/controllers/trailingRefreshCoordinator.ts`) collapses *repeat* requests into one trailing pass — something orca's dedupe does **not** do (it joins the in-flight promise but issues a fresh request after it settles). Adopting Finding 3 must not replace this: the two solve different problems and belong at different layers.
6. **Deliberate optimistic-UI restraint**, documented at `pi:docs/design/operation-model.md`. Orca has ~20 optimistic sites; PI WEB's refusal to optimistically bubble writes is a considered position, not a gap.

---

## 4. Recommended order of work

| Order | Finding | Est. effort | Cumulative |
|---|---|---|---|
| 1 | **#2** Transcript-cache quota eviction + byte budget (closest to a bug) | 0.5 d | 0.5 d |
| 2 | **#3** In-flight GET dedupe | 0.5 d | 1.0 d |
| 3 | **#4** Hover/focus prefetch on session rows | 0.5 d | 1.5 d |
| 4 | **#1** Stale-while-revalidate (needs #3 first) | 1 d | 2.5 d |
| 5 | **#8** Visibility jitter | 0.2 d | 2.7 d |
| 6 | **#7** Concurrency semaphore | 0.3 d | 3.0 d |
| 7 | **#6** Input-quiet gating | 0.5 d | 3.5 d |
| 8 | **#5** Code splitting (+ **#9** retry/reload guard) | 3-5 d | 6.5-8.5 d |
| — | **#10-13** | revisit after measuring | — |

Findings 1-4 form a dependency chain with a real payoff at the end: quota-safe cache (#2) makes cached views actually available; dedupe (#3) makes prefetch safe (#4); prefetch populates the cache; cache makes stale-while-revalidate instant (#1). Together, at ~2.5 days, they turn session switching from a blocking round trip into an immediate paint. That is the single largest perceived-performance change available to PI WEB in this comparison.

---

## 5. Anti-patterns: what NOT to take from orca

| Orca pattern | Why to skip |
|---|---|
| `staleWhileRevalidate` admission tiers (`interactive`/`status`/`background`) | Solves `gh` subprocess saturation. PI WEB's daemon is loopback and in-memory. Adds a scheduler to test for no measured win. |
| Virtualizing the transcript | Orca itself doesn't. Cost is 168 lines of anchor-convergence recovery (`virtualized-scroll-anchor-restore.ts:35-168`) plus a fourth state `readingAnchorDecision()` does not model. |
| `session-parse-cache-persistence` (schema-versioned disk cache of parsed sessions) | PI WEB owns its sessions and keeps them open (`piSessionService.ts:2367`). Most of the win already exists. |
| React-specific `lazyWithRetry` wrapper (`lazy-with-retry.ts:253`) | No Suspense in Lit. Take lines 34-120 (retry + reload guard), not the `React.lazy` factory. |
| Optimistic UI breadth (~20 files) | Contradicts `pi:docs/design/operation-model.md`. Only adopt per-case, where the operation is genuinely local-only. |
| Orca's 300 s `CACHE_TTL` (`cache-policy.ts:3`) | Tuned for GitHub API rate limits. PI WEB should use orca's shorter `WORK_ITEMS_CACHE_TTL = 60_000` (`cache-policy.ts:4`) or less, since the daemon can answer authoritatively in milliseconds. |

---

## 6. Citation index

**PI WEB**
| Concern | Location |
|---|---|
| sessionStorage transcript cache, silent quota swallow | `pi:src/client/src/chatHistoryCache.ts:2-3,14-35` |
| In-memory transcript LRU (count-bounded, 12) | `pi:src/client/src/chatTranscriptStore.ts:14,31,82-90` |
| Cached-view spread then `isLoadingTranscript: true` | `pi:src/client/src/controllers/sessionController.ts:298,326` |
| Blocking session-list refresh | `pi:src/client/src/controllers/sessionController.ts:937-947` |
| Single-flight refresh (3 parallel GETs, no dedupe) | `pi:src/client/src/controllers/sessionController.ts:1468-1498` |
| `MESSAGE_PAGE_SIZE = 100` | `pi:src/client/src/controllers/sessionController.ts:38` |
| Trailing refresh coalescer | `pi:src/client/src/controllers/trailingRefreshCoordinator.ts:15-65` |
| Gap repair / sequence replay | `pi:src/client/src/controllers/sessionController.ts:356-379` |
| API layer (52 lines, deadline only, no dedupe) | `pi:src/client/src/api/http.ts`, `pi:src/client/src/api/requestDeadline.ts` |
| Session list rows — no pointer prefetch | `pi:src/client/src/components/SessionList.ts:380` |
| Chat rendering, `repeat()`, no virtualization | `pi:src/client/src/components/ChatView.ts:988-1005,1271-1276,1434,1545` |
| Loading / empty / failed states | `pi:src/client/src/components/ChatView.ts:1622-1631,1650-1662` |
| Lazy images + scroll correction | `pi:src/client/src/components/ChatView.ts:697-720,1956` |
| Streaming append-only markdown parse | `pi:src/client/src/components/formattedText.ts:26-70` |
| Reading anchor decision | `pi:src/client/src/readingAnchor.ts` |
| Visibility gate + resume burst (no jitter) | `pi:src/client/src/appShell/browserResumeController.ts:41-76`; `pi:src/client/src/sessionActivityPolling.ts` |
| Only 2 dynamic imports | `pi:src/client/src/components/PromptEditor.ts:792`; `pi:src/client/src/plugins/external.ts:77` |
| `manualChunks` returns `undefined` for app code | `pi:vite.config.ts:109-117` |
| Entry chunk 1,016,264 B; 1 script tag; 0 modulepreload | `pi:dist/client/assets/`, `pi:dist/client/index.html` |
| Immutable asset caching (already correct) | `pi:src/server/web/app.ts:373` |
| Existing ad-hoc in-flight dedupe precedent | `pi:src/server/shared/projects/directorySuggestions.ts:168-195` |
| Multi-machine cache keying (at parity) | `pi:src/client/src/workspaceSessionsCache.ts:15-18`; `machineSessionKey` in `sessionController.ts` |
| `content-visibility` on uniform rows | `pi:src/client/src/components/SessionTreeNavigator.ts:551` |
| Optimistic-UI stance | `pi:docs/design/operation-model.md` |

**Orca** (all paths relative to `/tmp/orca-study-cache`)
| Concern | Location |
|---|---|
| SWR serve-stale + queue revalidation | `src/renderer/src/store/slices/hosted-review.ts:305-315`; error preservation `:270-283` |
| SWR cache state, admission tiers, TTL | `src/renderer/src/store/slices/hosted-review-cache-state.ts:37,74,121,145,172,188` |
| Freshness / bounded cache primitives | `src/renderer/src/store/github/cache-policy.ts:3-5,9-15,17-27,29-35,37-50` |
| Fetch flow: freshness → dedupe → force escalation → concurrency slot → bounded write | `src/renderer/src/store/github/work-item-fetch-actions.ts:96-135,195,223-229` |
| Generic in-flight dedupe (portable) | `src/shared/in-flight-promise-dedupe.ts:1-83` |
| Concurrency semaphore (portable) | `src/renderer/src/store/github/request-coordination.ts:53-70` (semaphore at `:53-58`) |
| Per-resource in-flight Maps | same file (work items / PRs / check details / comments / project views) |
| Byte-budgeted transcript cache (50 / 128 MB, mtime invalidation) | `src/main/native-chat/transcript-read-cache.ts:39-47,156-161` |
| Byte-budgeted LRU (16 MB) | `src/main/daemon/cold-restore-payload-cache.ts:14-29` |
| Byte + entry budget with pinning, generation counter, deferred revoke | `src/renderer/src/components/editor/local-image-src-cache.ts:9-11,40,53,71-125,129-134`; `local-image-cache-pinning.ts` |
| Hover / focus prefetch | `src/renderer/src/components/sidebar/SidebarTaskNavButton.tsx:130-144,164-165`; `WorktreeCardMeta.tsx:191` |
| Prefetch action (fresh + in-flight guarded) | `src/renderer/src/store/github/work-item-aggregate-actions.ts:232` |
| Visibility interval + 400 ms jitter | `src/renderer/src/lib/window-visibility-interval.ts:4-92` |
| Input-quiet scheduler | `src/renderer/src/lib/input-quiet-scheduler.ts:28-101` |
| Publication gate (100 ms quiet / 1 s cap / generation cancel) | `src/renderer/src/components/right-sidebar/ai-vault-session-publication-gate.ts` |
| Lazy chunk retry + bounded reload recovery | `src/renderer/src/lib/lazy-with-retry.ts:34-120,253` (~158 call sites) |
| Virtualization (worktree list only) | `src/renderer/src/components/sidebar/worktree-list/viewport/*`; `@tanstack/react-virtual` `package.json:199` |
| Anchor restore convergence loop | `src/renderer/src/hooks/virtualized-scroll-anchor-restore.ts:35-168` |
| Native chat NOT virtualized; memo + useMemo projections | `src/renderer/src/components/native-chat/NativeChatMessageList.tsx:73-141`; `NativeChatMessageRow.tsx:34,67` |
| Tail-append O(1) fast path | `src/renderer/src/components/native-chat/native-chat-incremental-assembler.ts:57-116` |
| Limit-growth pagination (300 initial / 200 page) | `src/renderer/src/components/native-chat/native-chat-pagination.ts:8-19` |
| Autoscroll threshold 48 px | `src/renderer/src/components/native-chat/native-chat-autoscroll.ts` |
| Parsed-session cache + byte-offset resume | `src/main/ai-vault/session-parse-cache-store.ts:10-102` |
| Disk persistence, schema versioning | `src/main/ai-vault/session-parse-cache-persistence.ts:18,59,73,94,146,221` |
| Immutable asset caching | `src/main/runtime/rpc/static-web-client-handler.ts:74-75` |
| Render-cost policing tests | `src/renderer/src/components/native-chat/NativeChatMessageList.stream-render.perf.test.tsx:14-24`; `.tool-stream-cost.test.tsx:8-24` |
