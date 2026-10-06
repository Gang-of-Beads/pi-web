# Show what is known at once, then move it into place

Status: design draft for the owner (2026-10-06). Nothing here is built yet.

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
so a reload or a cold start shows nothing until the board read lands.

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
- Persisted entries carry `{ version, key, savedAt, data }`, live at most 7 days, are capped per
  surface (the 200 most recent sessions per machine), and are dropped when their version changes.
  They share the browser's storage budget with the transcript cache, which already evicts by age.

### 2. Rows keep their identity across updates

Lists render with Lit's keyed `repeat` (the session id, the project id, the model reference), so a
row keeps its DOM node when it moves. Lists drawn with `map` reuse nodes by position, which makes
movement impossible to show and also moves focus and hover from one session to another.

### 3. One motion helper for every list

A small Lit directive, `listMotion`, around a keyed list:

- **Move:** rows whose box changed slide from the old place to the new one (200 ms, ease-out).
- **Enter:** a new row fades and slides in (160 ms).
- **Leave:** a removed row fades out from where it was, drawn from a short-lived copy, so the rows
  below close the gap with the same slide.
- Only rows on screen (plus a margin) are measured and animated; the rest just appear in place.
- No motion on the first paint from the cache, under `prefers-reduced-motion`, or while the reader's
  finger is down or the list is scrolling (the update waits for the release).
- The row the reader is looking at stays put: if an insertion above it would push it down, the
  scroll position follows, as the transcript's reading anchor already does.

### 4. Pickers open at once

- The model and thinking-level pickers open on the tap with the cached list and the current
  selection (the selection comes from the session's status, which is live), then fill in place
  when the read lands; a model added or removed animates like a list row.
- The first open on a machine, with nothing cached, opens at once with the current choice and a
  short placeholder, filled when the read lands.

## Plan

1. The cache tier and `listMotion`, on the Navigate session list first; measured on a real phone.
2. The pickers.
3. Projects, workspaces, machines, the quick switcher.
4. Plugin lists through the plugin API (an optional keyed-list helper), the files tree first.

## Questions for the owner

Listed in the ask that accompanies this draft.
