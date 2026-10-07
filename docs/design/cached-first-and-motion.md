# Show what is known at once, then move it into place

Status: approved by the owner on 2026-10-06 (start, the quiet motion, `localStorage`). Step 1,
the remembered session board and list motion on the Navigate page, is built; the pickers and the
other lists are not yet.

## The request

Owner, 2026-10-06: many pages, the list pages first, can show their cached content at once and,
as sync messages arrive, reorder rows and animate a session being added or removed in place. That
is much better than waiting for the page to load completely before showing it. Choosing a model or
a thinking level is the same.

This sits on top of sync convergence (`sync-convergence.md`): routine syncing stays quiet, the top
row alone says "Trying to sync with the server…" when a request goes unanswered, and every
retained value carries the scope it belongs to.

## What it costs today (measured on 8505, 2026-10-06)

Headless Chrome, 1280 × 860, served from localhost; the 300 ms rows add 300 ms to every request in
the page, to stand in for a phone's round trip.

| Surface | Local | One 300 ms round trip |
|---|---|---|
| Thinking-level picker, tap to open | 10-13 ms | 337-346 ms |
| Model picker, tap to open | 30-73 ms | 344-379 ms |
| Session list on a cold load, navigation start to first rows | 1.56-1.83 s (all 166 rows at once) | not measured; every boot read adds a round trip |

The pickers wait for their reads before they open (`openModelDialog` reads the model list and the
catalog, `openThinkingDialog` the levels), so a phone pays a round trip on every tap. The session
list keeps its last answer in memory only (`workspaceSessionsCache.ts`, the board's 30 s freshness),
so a reload or a cold start shows nothing until the board read lands. The board answer for those
166 sessions is 172 KB of JSON (about 1 KB a row, 20 KB gzipped on the wire).

## Measured after step 1 (8505, 2026-10-06)

Headless Chrome, fine pointer; a real phone and a coarse pointer are not checked yet.

| Check | Result |
|---|---|
| Cold load, nothing remembered (1280 × 860) | 166 rows at 1084 ms, after the board answered at 1036 ms; 171 KB remembered |
| Warm load, three runs (1280 × 860) | 166 rows at 110-140 ms; the board answered at 223-323 ms |
| Warm load (393 × 850) | 166 rows at 116 ms; the board answered at 245 ms |
| Board read blocked, warm load | the remembered rows stayed for 8 s while the read was retried 4 times; nothing said "No sessions yet." |
| A server change removes a row on screen | one fading copy and 12 rows sliding (of 166; only the band near the visible part), 200 ms |
| The row comes back | one fade-in and 12 slides |
| The same removal right after a press, under reduced motion, and a search that narrows to 44 rows | no motion |

## Can it be animated? (feasibility)

- **View Transitions are not usable here.** Same-document view transitions are baseline since
  2025-10-14 (Chrome 111, Safari 18, Firefox 144), but every list here lives in a Lit shadow root,
  and Chromium ignores `view-transition-name` inside shadow DOM (crbug 349653208). Element-scoped
  transitions, which would fix that, are behind a flag in Chrome 140.
- **FLIP on the Web Animations API works everywhere, shadow roots included.** Record each keyed
  row's box before the update, let Lit render, record it after, and animate the difference as a
  `transform` (the compositor's job, not layout's).
- **Main-thread cost, measured on the real list** (166 rows, the Navigate page, reversed in place):
  0.2 ms to record every box, 2.3 ms for the one forced layout after the update, 0.4 ms to start the
  animations for the 15 rows on screen (1.4 ms for all 166). Well inside a frame.
- **Smoothness is not proven here.** Headless Chrome renders in software, and its frame cadence was
  as uneven with no animation at all (median 100 ms) as with one, so it cannot tell. It needs one
  check on a real phone; the design animates only rows on screen to bound the cost either way.
- **Lit's own `@lit-labs/motion`** implements the same technique as a directive, but it is a labs
  package and a dependency; a helper of about 80 lines does what is needed below.

## What others do (research, 2026-10-06)

### Showing cached content first

- **Stale-while-revalidate** is the standard shape: answer from the cache at once, fetch a fresh
  copy in the background, replace in place (RFC 5861; web.dev "Keeping things fresh with
  stale-while-revalidate"). It trades bounded staleness for no waiting.
- **Linear** keeps its data in IndexedDB and boots from it: "the client trusts what's local, the
  server is the source of truth for correctness, and the two reconcile asynchronously". An inline
  script reads `localStorage` before the bundle loads so the first paint already has the right
  shell; the first request that fails (an expired session) is what redirects, nothing is checked up
  front. Updates arrive as small deltas and re-render only the cells that changed
  (performance.dev, "How's Linear so fast?", 2026-05).
- **TanStack Query's persister** (the common library form of the same idea) restores the cache on
  start, discards it when it is older than `maxAge` (24 h by default), when its `buster` string
  (the app version) differs, or when it is empty or unreadable, and throttles writes to at most one
  a second.

What this design takes from them: render from the cache for the current scope, revalidate at the
same time, drop the cache on version change or age, throttle writes, and let the existing paths
(session gone, top row) handle the case where the cache was wrong.

### Motion for lists

Two credible positions exist, and both come from people who build list-heavy tools:

- **No list motion.** Linear puts "no transitions on list items to keep things snappy"; its
  durations are 100, 250 and 350 ms elsewhere, and things appear instantly and fade out over
  150 ms. Emil Kowalski (Linear's design engineer, "You don't need animations"): the more often a
  user sees an animation, the less it should animate; keyboard-initiated actions should never
  animate; UI animations should stay under 300 ms.
- **Short motion for changes the user did not cause.** web.dev's CLS guidance counts a layout
  shift as bad when it is not within 500 ms of the user's own input, and says content that "moves
  gradually and naturally from one position to the next can often help the user understand what's
  going on"; use `transform`, and respect `prefers-reduced-motion`. WCAG 2.3.3 asks that motion be
  avoidable. The platform defaults are short: Android's RecyclerView (the default list animator on
  Android) adds and removes in 120 ms and moves in 250 ms; AutoAnimate moves in 250 ms, skips rows
  off screen, and turns itself off under reduced motion.

Timing references: Material 3 tokens put short motion at 50-200 ms and medium at 250-400 ms, with
the standard easing `cubic-bezier(0.2, 0, 0, 1)`, entering on a decelerating curve and leaving on
an accelerating one. NN/g: 100 ms for feedback, 200-300 ms for larger changes, 400 ms only for big
moves; entering slightly longer than leaving; the more frequent, the shorter and subtler.

What this means here: the session list changes mostly because of the server (a session started
asking, finished, appeared on another device), not because of the reader, so it is the case CLS
warns about and the case where motion explains what happened. The reader's own actions are the
case where motion only slows them down. The list is seen many times a day, so the motion must be
short and quiet. PI WEB already holds row order under a finger for 600 ms after release
(`heldRowOrder.ts`), the same idea as CLS's 500 ms input window.

### Where a cache can live (browser storage)

"Local" here always means the browser on that device: nothing is shared between the phone and the
desktop, and nothing is stored on the server.

| | In memory | `localStorage` | IndexedDB |
|---|---|---|---|
| Survives a reload or a closed tab | no | yes | yes |
| Read before the first paint | yes | yes (synchronous) | no (asynchronous, after the page starts) |
| Size | page memory | about 5 MiB per origin, shared with the transcript cache already there | a large share of the disk |
| Used by | today's lists | PI WEB's transcript cache, Linear's boot script | Linear's data, TanStack's async persister |

Both persistent stores follow the same deletion rules (MDN "Storage quotas and eviction criteria",
WebKit "Updates to Storage Policy"): data is best-effort and is dropped when the device runs out of
space, oldest site first; Safari also deletes all script-written storage after seven days of Safari
use without interacting with the site, but a site added to the Home Screen counts its own days of
use and is not expected to lose its data. `navigator.storage.persist()` can protect it, but a cache
does not need protecting: losing it costs one cold load, the same as today.

## Design

### 1. Show from a scoped cache, sync in place

| Surface | Cache key | Kept |
|---|---|---|
| Session list (Navigate, Go to, quick switcher) | machine (+ project filter) | the board's rows, ordered, persisted per machine |
| Project and workspace lists | machine | the last listing, persisted |
| Model picker | machine | the model list and catalog from the last read |
| Thinking-level picker | machine + model | the levels from the last read |

- The page renders the cached value for the current key at once and asks for the fresh one at the
  same time. Nothing says "stale": routine syncing is quiet (owner, 2026-10-06), and a link that
  does not answer is the top row's to say.
- A value is drawn and actionable only for its own key, never for another machine, project or model.
  Tapping a cached row does what it always does; a session that is gone by then follows the
  existing "session gone" path.
- Persisted entries live in `localStorage` (owner, 2026-10-06) under a versioned key per surface
  and scope, as `{ savedAt, data }`. They live at most 7 days, are written at most once a second,
  and are dropped when they do not parse. An entry is kept whole or not at all: one larger than
  1 MiB is not written, because a trimmed list would draw something that was never true. They
  share the transcript cache's budget: when the store is full, the oldest transcript page makes
  room.
- A remembered value is not an answer. While it is drawn the surface still counts as unanswered,
  so nothing claims "No sessions yet." from it, and a machine that stated a refusal (signed out,
  forbidden) draws no remembered list at all.

Built for the session board (`sync/boardMemory.ts`, `SessionBoardController`): the board a
machine last answered, whole, keyed by machine. Navigate, Go to and the quick switcher all draw from
it. Announcements heard before the first read (a rename, a new session) apply to it as they do to
the live board.

### 2. Rows keep their identity across updates

Lists render with Lit's keyed `repeat` (the session id, the project id, the model reference), so a
row keeps its DOM node when it moves. Lists drawn with `map` reuse nodes by position, which makes
movement impossible to show and also moves focus and hover from one session to another.

### 3. One motion helper for every list

`ListMotion` (`listMotion.ts`) around a keyed list: the page calls `prepare` before each render
with the keys it will draw and who caused the change, and `play` after it. Rows carry
`data-motion-key`, so a row drawn as a new node in another section is still matched to where it
was. The "quiet" setting (owner, 2026-10-06):

- **Move:** rows whose box changed slide from the old place to the new one, 200 ms,
  `cubic-bezier(0.2, 0, 0, 1)`, `transform` only.
- **Enter:** a new row fades in, 150 ms, opacity only; the rows below make room with the move.
- **Leave:** a removed row fades out where it was, 120 ms, drawn from a short-lived copy; the rows
  below then close the gap with the move.
- No scale, bounce, spring or stagger.
- Only changes that came from the server animate. Whether a change is the reader's is one pure
  classifier, `listMotionGate`: a new scope (kind, search, project, fold, tile count, machine), a
  press or key anywhere in the app within `TAP_SETTLE_MS`, and a change the host is still carrying
  out for the reader from the list (a row action, a new session) all apply at once.
- Only rows within half a list-height of the visible part are animated; the rest land in place.
  Rows are measured only when the keys the list draws change, so a render that only updates what a
  row says costs no layout read.
- No motion on the first paint, when the list had no rows before, or under
  `prefers-reduced-motion`.
- While the reader's finger is down, and for `TAP_SETTLE_MS` after it lifts, the order holds
  (today's `heldRowOrder`); when the hold ends the new order animates in.
- The row the reader is looking at stays put: if an insertion above it would push it down, the
  scroll position follows, as the transcript's reading anchor already does. Not built in step 1:
  the list relies on the browser's own scroll anchoring where it exists.

### 4. Pickers open at once

- The model and thinking-level pickers open on the tap with the cached list and the current
  selection (the selection comes from the session's status, which is live), then fill in place
  when the read lands; a model added or removed animates like a list row.
- The first open on a machine, with nothing cached, waits for the read as it does today (owner,
  2026-10-06).

### 1b. Wait half a second before the remembered list (owner, 2026-10-07)

Ask `434f7058`, the owner's words: try loading for about 0.5 s; if the list loads in that time,
show the new one directly; if not, show the cache plus what has loaded, and animate the later
update in, keeping the motion simple, fast and smooth.

- **The hold.** The first time a page asks for a machine's board, the list waits up to
  `REMEMBERED_HOLD_MS` (500 ms) for the live answer (`SessionBoardController.board`). An answer
  inside the hold is the first paint, with no motion (the list had no rows). When the hold ends
  without an answer, the controller's listeners draw again and the remembered board is drawn; the
  live answer, when it lands, replaces it with step 1's list motion (server-caused, quiet).
- **Cache plus what loaded.** The board is one read, so it lands whole: the list changes once
  when the answer arrives, never row by row, which is what keeps the top of the list from
  reshuffling while it loads. When the answer is partial (a project, workspace or pin did not
  answer), the remembered rows of exactly those sources stay (`boardFilledFromMemory`) until a
  retry answers them. A remembered row of a source that did answer is never kept.
- **The top row says "Syncing…".** While the session list is on screen and drawn wholly from
  memory, the app row says "Syncing…" in the muted tone (owner: "直接上面 notification row 的
  syncing 就好了吧？这样用户知道在加载中/同步中"). It is the quietest claim: a notice and "Trying
  to sync with the server…" (nothing answered within the ack timeout) come first. A partial live
  answer filled from memory does not say "Syncing…": the board's own retries stay silent (owner
  Q4, 2026-09-30: the board is not an app-row cause). No mark on the rows themselves.

## Plan

1. The cache tier and `listMotion`, on the Navigate session list first; measured on a real phone.
2. The pickers.
3. Projects, workspaces, machines, the quick switcher.
4. Plugin lists through the plugin API (an optional keyed-list helper), the files tree first.

## Decided

- 2026-10-06: start, in the order of the plan; the quiet motion; the cache in `localStorage`.
- 2026-10-06: the first picker open with nothing cached waits, as today.
- 2026-10-06: the unreachable fzf ranking for `@` completions is deleted, not revived.
- 2026-10-07: wait 0.5 s for the live list before drawing the remembered one; fill a partial
  answer from memory; "Syncing…" in the top row while the list shown is remembered (1b).

## Questions for the owner

None open.
