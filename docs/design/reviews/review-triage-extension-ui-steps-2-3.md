# Review triage: extension UI counterpart, steps 2 and 3

Commits reviewed: `d15204fa` (notify), `1675b439` (standing values). Workflow `1b0589cf`:
lane A daemon and protocol (`botim-bllm/deepseek-v4.1-flash:max`), lane B browser and scope
(deepseek), lane C full pass (`anthropic-merchant/claude-opus-5:max`). All three: "OK with notes",
no blocker. Each suspicion below was settled by reading the source, not by trusting a lane.

## Fixed

| # | Lanes | Finding | Settled by | Fix |
| --- | --- | --- | --- | --- |
| 1 | C F1, A F4 | A widget component's `render()` ran on every status computation, once per shell output chunk; a `render()` that calls `tui.requestRender()` looped at 10 Hz. | `statusFromSession` calls `snapshot()`, which drew every component. pi-goal's widget reads its ledger file on each render (`goal-widget.ts` `getLedgerEvents()`), so a build's output cost one file read per chunk in the daemon. | A component draws when it asks (`requestRender`) or when its drawing is a second old, at the next status; a request made while it draws is ignored. |
| 2 | C F2 | The cut note on a component widget always said "2 more lines". | `drawn()` asked for 101 lines, so the count was always 101. | Draw in full, then cut, so the note counts what was cut. |
| 3 | C F3 | Widget line length was unbounded. | Only the line count was capped; `statusText` bounds every other text. | Each widget line is cut at 1,000 characters, indentation kept. |
| 4 | C F4 | Values outlived the reload's start by the whole resource reload, and a runtime with no notification generation never cleared on reload. | pi calls `resetExtensionUI()` before `session.reload()`; PI WEB cleared in `beforeSessionStart`, passed only with a generation. | Clear when the reload starts, and again just before the new `session_start` (drops whatever shutdown handlers wrote); the hook is always passed. |
| 5 | A F3, C F11 | Widget components were not disposed on a failed open, on a runtime rebind (fork, `/new`, tree), or on service dispose. | `clear()` (which disposes) was missing at those three sites. A disposed widget's `requestRender` still scheduled a publish. | `clear()` at each site; a disposed component's redraw request does nothing. |
| 6 | A F2 | Closing a session (archive, delete) left its runtime's statuses and widgets on screen. | The daemon cleared after the close but its publish found no active session; the browser ignores `session.stopped`. | On `session.stopped` with cause `closed`, the browser drops that session's standing values. A status from the dying runtime is not published: it would rerun warning filing after the notification store was cleared. |
| 7 | A F1, B F10 | A notify level outside info/warning/error lost the line (the frame failed to parse). | The daemon forwarded `type ?? "info"` raw; the parser throws on any other level. Before step 2, any non-error level drew as info. | The daemon maps the level through a lookup; anything else is info, as pi and the notification store treat it. |
| 8 | B F1 | An error notice that arrived while the transcript tail was trimmed was dropped. | Both trimmed branches count the event on the "newer" chip and drop it; loading newer rebuilds from the daemon, which keeps no notice. | Notices that arrive while trimmed are held (per machine and session) and appended when the newer page reaches the tail. |
| 9 | B F2 | The opened status list had no height cap. | `.extension-statuses.open` set no max-height; the transcript absorbs the growth. | Capped at 40% of the viewport, scrolling inside itself. |
| 10 | B F3 | The 40-character clip could split an emoji. | `slice` by UTF-16 index. | Clip by code point. |
| 11 | B F5, C F10 | The status line's open state followed the reader into another session. | One `status-bar` element, no reset; the widgets reset on `sessionKey`. | `status-bar` takes the same session key and folds on change. |
| 12 | B F4, C F5 | The notice row ignored the chat measure, rhythm and phone inset. | `.msg-notice` had no rule; the button padded itself. | `.msg-notice` takes the measure and rhythm and joins the bare row group (`rowGroups.ts`); the button no longer pads itself. |
| 13 | C F6 | The notice button had no tap floor. | No min-height on `.extension-notice`. | The compact control floor, as the status line and "Show all" have. |
| 14 | B F6 | Notices from one flush shared an expand key, and a repeat folded an opened notice. | Key was `String(part.at)`; a repeat rewrites `at`. | Each notice line gets its own id, kept across repeats. |
| 15 | B F7 | The extension title skipped the π mark and the 40-character bound, and named the tab outside the chat view. | `syncDocumentTitle` used the title raw, before `documentTitleFor`. | `focusedContextName` takes the extension title in the chat view only; `documentTitleFor` prefixes and bounds it. |
| 16 | B F8 | `setWorkingVisible(false)` also hid the turn clock and plugin notes. | The dock returned `null` before them; pi hides only its spinner. | Hidden working drops the mark and the words; the clock and notes stay. |
| 17 | C F9 | `.working-mark` had no rule and a long frame could push the words out. | No CSS for the class. | Fixed width, at most 8 characters. |
| 18 | C F7, C F8 | The design doc's limits table still described "+n" and a sheet; the plugins docs dropped "while it is still the last row" from info replacement. | Read against `StatusBar.ts` and `extensionNotices.ts`. | Docs corrected. |
| 19 | C F12 | The coalescing docstring said ten frames a second, not ten frames a second to every browser on the machine. | `publishStatus` also publishes on the machine-wide channel. | Docstring corrected. |

## Not fixed, with reason

| Lanes | Finding | Reason |
| --- | --- | --- |
| A F5 | The notify frame has no timestamp, so a replayed buffer can merge two identical warnings minutes apart into one "×2" line. | The text is never lost, only its count; the frame shape would change for a reconnect-replay corner. Revisit if a report shows it. |
| A nit, B F9 | `setWorkingMessage("")`, `setHiddenThinkingLabel("")` and `setTitle("")` restore PI WEB's words, where pi keeps the blank. | A blank label in a web control leaves an unlabelled control and a blank tab; restoring the default is deliberate. |
| B F9 | The extension's working words replace the daemon's step narration. | As pi's loader: an extension that sets working words owns the row's words. |
| B F11 | "Show all" is kept by key when a widget's content is replaced. | The reader opened that widget; keeping it open across an update is the expected reading. |
| A nit | A non-string widget line whose `toString` throws escapes into the extension's own `setWidget` call. | Synchronous, in the extension's call, as bad input to pi would. |
| A nit | The parser drops a whole frames/lines array on one non-string element. | Unreachable from this daemon, which converts every element. |
| C note | StatusBar and ChatView read `status.extensionUi` without `openSessionStanding`. | Not a defect: every writer of `state.status` keeps it the open session's (lane C, hunt 7). |

## Judged not true

| Lanes | Suspicion | Evidence |
| --- | --- | --- |
| A hunt 1 | Values leak into a new runtime. | WeakMap keyed by the `PiAgentSession` object; a rebind is a new object. |
| A hunt 6 | Proxy routing breaks dialogs, `theme` or `has`. | pi's `wrapUIPromptContext` spreads own keys of `noOpUIContext`, which include every routed name. |
| B hunt 1 | A value renders under another session or machine. | `openSessionStanding` checks the id; selection and status change in one patch; a machine switch clears both. |
| B hunt 6 | The thinking label should spare old blocks. | pi relabels every thinking block (`interactive-mode.js`). |
| C hunt 4 | Older bundles or daemons break. | Unknown status fields are dropped by the parser; an unknown frame is dropped alone. |
