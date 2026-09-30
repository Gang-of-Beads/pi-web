# Review triage: P3 slice b, the subagents panel is quiet while nothing runs

Review run `e6dce7c9`, two lanes on the builtin `reviewer`:
- Opus 5.5: `review/p3b-opus.md`.
- DeepSeek 4.1 max: `review/p3b-deepseek.md`.

Both lanes blocked the first cut on the same P1. It was redesigned and re-tested before commit. Each finding is marked fixed, not fixed with the reason, or judged not true.

## The first cut

`follow()` compared the activity it saw against the last one it recorded. It read on a change and polled while the session worked.

## Findings

| # | Lane | Finding | Verdict | What changed |
|---|---|---|---|---|
| 1a | both, P1 | `follow()` runs only when the panel or its tab badge is drawn. The chat draws neither. So work that starts and ends out of sight compares idle against idle when the reader looks again, and the list read before the turn stays. | **True, fixed** | The plugin forgets its record on the host's `session-activity-settled`, so the next look reads. The host now also announces that event when the last background run of the selected session ends while no turn runs (`sessionWorkSettled.ts`); before, only a turn's end did. |
| 1b | both, P1 | A poll started while the session worked keeps running in the chat after the work ends. No follow ever sees idle, so it costs 20 run reads and 20 pin reads a minute. | **True, fixed** | Each answer asks the host to draw. Two answers that nobody drew stop the poll and forget the record. A read still in flight is not evidence of anything, so a stalled read never stops a watched poll. The first cut counted polls instead, and the existing 36 s stall test caught that. |
| 2 | Opus P1, DS P2 | The one read on an edge can be swallowed by a read already in flight, and that read may predate the edge. The poll stops on the same follow. | **True, fixed** | `RunsRead.refresh()` reads now. If a read is on its way, it reads once more when that one lands. There is still one read in flight at most. |
| 3 | Opus P2 | An unknown status was treated as idle (absence taken as negation). | **True, fixed** | `unknown` is its own activity. It is no news: it neither starts a poll nor counts as a change. The read a new selection makes is therefore not doubled when the status lands. |
| 4 | Opus P2, DS hunt 3 | No `dispose`, so the interval outlives an unregistered plugin. | **True, fixed** | `dispose: stopPolling`, with a test. |
| DS F3 | DS P2 | The fixture test "keeps the rows it already showed when a later read fails" had become vacuous: an idle panel started no second read. | **True, fixed** | The panel is given a working status, and the test asserts that the second read exists before failing it. |
| DS F4 | DS P2 | The status the decision rests on was read through duck typing on `unknown`. | **True, fixed** | `PluginRuntimeState.status?: PluginSessionStatus` declares the narrow part a plugin reads. The plugin API baseline is refreshed. |
| DS F5 | DS P2 | The object model inventory still describes the old poll. | **True, fixed** | §1.15 updated. State-diagram D5 has a subsection with this state machine. |
| DS F6 | DS P2 | Two classifier states were not enumerated. | **True, fixed** | The classifier is now a table of all 12 followed × next cells, and the test enumerates every cell. |
| DS note | DS | The predicate is narrower than the shell's `isSessionActive`. | **True, kept on purpose** | The docstring says why: compacting, a reader's shell command or a queued message start no run. |
| Opus hunt 1 | Opus | `state.status` could belong to another session. | **Judged not true** (both lanes) | `applyStatus` writes only for the selected session, and selection clears it. |
| Hunt 5 | both | Leave the remaining 7 pin reads a minute to P5. | **Agreed** | Raising `PIN_REFRESH_MS` is a freshness trade-off, not a mechanical fix. P5 replaces the render-driven read with an event. |

## Found live on 8505, after the review

`probe-subagents-quiet.mjs`, phone 393×850, work out of sight driven by a shell command. The second build passed 12 of 14 legs: one runs read happened in the chat at the settle, and coming back then read nothing.

- **Cause:** the host keeps the active workspace panel rendered while the phone shows the chat, hidden by the layout, and re-renders it on every app update. So the panel's render ran `follow()` in the chat. A render is not a look.
- **Fix:** a zero-height marker in the panel's template reports, through an IntersectionObserver, whether the panel is on screen. A render while it is off screen reads nothing and keeps nothing alive. Coming back on screen asks for a render. Before the first report, or where nothing observes, the panel counts as on screen.
- **Tests:** the harness now draws the panel on every request, on screen or not, as the host does, and reports visibility through the marker in the real order: render first, then the observer. Both new mutants (every render counts as a look; no render on coming back) are killed.

## Residual, recorded

- `backgroundRunCount` also counts background shell tasks. A dev server that keeps running keeps the panel polling while the panel or its badge is on screen. That is no worse than before. The run list's own head (P4) removes it.
- A run that starts and ends between two daemon scans, outside any turn, moves no count. Nothing announces it, so the list read before it stays until the next look after a settle. Every agent-launched run starts inside a turn, and the turn's end covers it.
