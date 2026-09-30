# PI WEB state diagram: one owner per state, every bug on the map

Owner, 2026-09-30: "强烈建议你用一个状态流转图，开发的过程中如果遇到新的状态，要考虑其合理性然后并到图里，这样你一直能有一个全局状态的view……所有问题都应该能在状态图中体现". (Use a state-transition diagram. When development hits a new state, judge whether it is reasonable and merge it in, so there is always a global view. Every problem should show on the diagram.)

This is the map. Code follows it; it does not follow code.

- **Inventories** (file:line for every claim): workflow run `853ed7cb`, `state-inventory/{messages,status-and-strings,scroll-and-docked-cards,dialogs-sync-socket}.md`.
- **Reviews:** run `e7c7403c`, closure (Opus 5.5) and consistency (DeepSeek 4.1 max). Both are triaged at the end of this document.
- **UI/UX methodology research:** `state-review/uiux-methodology.md`.

## Rules

1. **One owner per state.** Each state has exactly one writer and a fixed set of values. Every other place derives from it; nothing keeps a second copy that can disagree. A cache or a local store is a persistence of the owner's state, not a second state.
2. **Words are output; identity is an id.** A label, a message or an error sentence is rendered from a state and never read back to decide one. Identity crosses a boundary as an id, never as matching text. Typed discriminants (`type`, `kind`, `phase`, `status` fields, exact `customType` constants) are fine. Known debt, each tied to an item here:
   - the commit claim by text (`committedPromptIdentity.ts:39-45`), removed by the `prompt.committed` frame (D1);
   - the pre-ask claim's text fallback (`pendingAskStore.ts:193-198`);
   - the 20 text-decided sites of B16.

   One exception is named and permanent: a scraped terminal screen (the parsed-card fallback). A parse that cannot decide is `unknown` and falls back to the raw frame.
3. **Each transition happens once, and only forward.** Every state has a rank.
   - A fact for a later state applies from any earlier state (skip forward).
   - A fact for an earlier state is ignored, unless it is a named return drawn here.
   - A return keeps the thing's identity and its original times.
4. **Plugins append; they do not own.** A plugin adds information to a fixed core state through a declared contribution point. It never adds a core state and never replaces one. A disabled plugin's appendages disappear, and its open cards are cancelled.
5. **Unknown is a state.** The absence of an answer is `unknown`, never `empty`, `idle` or `current`. A failed read is `unknown` for the source that failed, shown with a retry.
6. **New state, new arrow, here first.** A change that needs a state, a transition or a wire frame not drawn here adds it to this document, with its reason, in the same commit as the code.
7. **PI WEB owns the chrome.** Nothing is injected between the header and the transcript, or between the transcript and the composer. The only exceptions are the status line and the back-to-bottom key (owner, 2026-09-30: "pi web就不该支持这里注入任何bar以及元素").

## D1. A message (one record per `clientMessageId`)

```mermaid
stateDiagram-v2
    [*] --> sending: reader presses Send (includes a send made before the session backend exists)
    [*] --> queued: another device's or the CLI's message, seen through a frame
    [*] --> committed: a user entry with no clientMessageId (continuations, extension prompts, old history)
    sending --> queued: POST answered (the answer is the acceptance: seq, acceptedAt)
    sending --> unverifiable: no answer (timeout, dropped link, 5xx)
    sending --> notSent: definite refusal (4xx)
    unverifiable --> queued: ledger says accepted
    unverifiable --> committed: ledger says committed
    unverifiable --> consumed: ledger says handled
    unverifiable --> refused: ledger says refused
    unverifiable --> withdrawn: ledger says withdrawn
    unverifiable --> notSent: ledger says never received
    notSent --> sending: Retry (same id)
    unverifiable --> sending: Retry (same id)
    refused --> sending: Retry (same id)
    notSent --> discarded: reader deletes it
    unverifiable --> discarded: reader deletes it
    refused --> discarded: reader deletes it
    queued --> handed: daemon hands the whole queue at an injection point (prompt.handed)
    handed --> queued: pi returned it unread (prompt.returned; same seq, same acceptedAt)
    handed --> committed: pi wrote its user entry (prompt.committed, carries entryId)
    handed --> consumed: pi took it with no user entry, e.g. a handled command (prompt.consumed)
    handed --> unverifiable: daemon restarted before pi read it (ledger unknown)
    queued --> withdrawn: reader recalled it or cleared the queue
    queued --> refused: terminal refusal after acceptance
    handed --> refused: terminal refusal after handoff
    committed --> [*]
    consumed --> [*]
    withdrawn --> [*]
    discarded --> [*]
```

- **Owner.** The daemon owns everything from `queued` on. The browser owns only the states before the daemon knows the message: `sending`, `unverifiable` and `notSent`.
  - The pre-start client queue and the durable outbox are persistences of `sending` and `notSent`, not extra states.
  - There is **one** state per record. The row mark, the pending block and the status queue are all views of it.
- **Wire (new under rule 6).** A frame is how the page learns each daemon arrow. The page never infers a state from an id leaving or entering a list.
  - Existing today: `prompt.accepted`, `prompt.refused`, `prompt.withdrawn`.
  - New: `prompt.handed`, `prompt.returned`, `prompt.committed` (carries `entryId`) and `prompt.consumed`.
  - Every frame carries `seq` and `acceptedAt`. `seq` is a new persisted inbox field, and take-back and `restoreFront` keep it.
  - A duplicate send is answered with the ledger's actual outcome, not always `accepted`.
- **Correlation.** `committed` is a daemon fact. pi writes each message of a handed batch as its own user entry, in order, so the daemon joins entries to the batch by position; text is only a cross-check. On a page rebuild, a pending record whose `clientMessageId` appears on a reloaded entry becomes `committed`, not a second row (this joins D1 to D5).
- **The queue is for waiting, not for pacing** (owner, 2026-09-30).
  - Queued messages are separate items only so the reader can recall one, edit it and send it again.
  - At an injection point (the session accepts steering: a step has ended, or the agent is idle) **every** queued message is handed at once, in `seq` order, as one batch. Each keeps its own row and identity.
  - A recalled message leaves the queue (`withdrawn`) and returns to the composer. Sending it again makes a new message at the tail.
- **Restart.** A `queued` message survives a daemon restart and stays visible as queued, with its original time. It is handed at the next injection point, so it never "reappears": it never left.
- **Automatic resend.** The outbox resends on reconnect only a `notSent` record made on this device within the last 10 minutes. Anything older stays `notSent` with Retry. An `unverifiable` record is re-asked of the ledger, never blindly resent.
- **Row placement is a function of state**, with exactly one row per id. The transcript tail, from the top:
  1. `committed` rows, at their entries' indices;
  2. the pending block: `queued` and `handed` ordered by `seq`, then `sending`, `unverifiable` and `notSent` ordered by send time;
  3. records of closed cards (D2), in close order;
  4. open cards (D2), FIFO.

  `consumed`, `withdrawn` and `discarded` leave no row; a settled notice appears only where the owner already chose one.
- **Status queue list.**
  - It is ordered by `seq`: the daemon emits it that way, and the lane-by-lane composition (`piSessionService.ts:6409-6420`) goes.
  - It only orders and counts records; it never changes a record's state.
  - Its position is the status stream's `{epoch, seq}` (`statusReadVerdict`).
- **One timestamp that never moves.** A row shows when it was sent: the client's send time when this device sent it, the daemon's `acceptedAt` for a message from elsewhere. It never switches clocks. The commit time is in message info.
- **Words** (owner-approved vocabulary, output only):

  | State | Word |
  |---|---|
  | `sending` | Sending… |
  | `unverifiable` | Receiving… |
  | `notSent` | Not received · Retry |
  | `queued` | Queued · n |
  | `handed` | Received |
  | `refused` | Not accepted · Retry |

## D2. A docked card (asks, extension dialogs, declared screens, plugin cards)

```mermaid
stateDiagram-v2
    [*] --> refused: open rejected (too long, bad options)
    [*] --> open: ask_user, ctx.ui.select/confirm/input/custom, plugin card
    open --> open: redraw (same id, new lines)
    open --> answered: reader answers
    open --> cancelled: reader cancels, Stop, timeout, run end, a chat message (oldest ask), owner plugin disabled, daemon restart, session closed
    answered --> [*]
    cancelled --> [*]
    refused --> [*]
```

- **Owner.** The daemon's card stores own a card. Cards are session-scoped and FIFO.
- **Cancel causes are typed:** `reader`, `stop`, `timeout`, `run-end`, `reader-sent-message`, `owner-disabled`, `daemon-restart`, `session-closed`. The waiter always resolves, so an extension's `await` never hangs.
- **Class.** `ask_user`, extension dialogs, declared screens and plugin cards are one class.
  - A plugin opens a card through its server half, into the daemon store, with a declared contribution point (`dockedCards`). An answer routes back through the same store.
  - Disabling the plugin cancels its open cards (`owner-disabled`).
- **Rendering.**
  - Every open card renders, FIFO: asks already do, and dialogs follow (no more "N more queued").
  - A card renders once, natively. A declared screen is the Questions card; an undeclared terminal screen is a parsed native option card; the raw frame is the last resort. One question never passes through two cards.
  - A card has exactly one capped inner region, within the waiting slot's 60vh budget. It chains the wheel and touch to the transcript at its end and when it does not overflow; `overscroll-behavior: contain` is for overlays only. The action row never scrolls away.
  - The card re-renders whenever any rendered field changes, including `lines` and `screen`.
- **Placement.** Open cards are the tail of the transcript (D1 order). In D4 `following` they stay in view. In `reading`, an open card below the fold lights the back-to-bottom key with "Waiting for you", whatever the distance. The reader is still never moved.
- **An answer is a message.** Answering a card creates a D1 message:
  - it is `queued` from the moment it is submitted, and its answers record shows in the transcript;
  - it is FIFO with the reader's other messages;
  - it is handed at the next injection point with everything else waiting.

  It never goes into pi's follow-up lane, which waits until the agent has no work left. The same holds for PI WEB's own notices meant for the agent (subsession completion). Measured 2026-09-30: four answers waited 9.5, 10, 26.7 and 14.5 minutes, invisibly (`piSessionService.ts:1997`, `:2688`).
- **A refusal is a state the reader sees.** A refused open files a session notification. It is owned by the notification inbox, scoped to the session, and dismissible. It is never only an error inside the extension.
- **A closed card is inert.** A card kept on screen while a gesture settles has no live handlers. A tap on a card answered elsewhere shows "Answered elsewhere".

## D3. What a session is doing

```mermaid
stateDiagram-v2
    [*] --> unknown
    unknown --> idle: status read or frame
    unknown --> working: status read or frame
    idle --> working: turn starts, or compaction / bash / tree navigation starts
    working --> idle: turn ends (once), or the out-of-turn work ends
    working --> background: turn ends while background work > 0
    background --> idle: background work reaches 0
    background --> working: next turn starts
    idle --> asking: a card opens
    working --> asking: a card opens
    background --> asking: a card opens
    error --> asking: a card opens
    asking --> working: last card closes, turn running
    asking --> background: last card closes, turn over, background work > 0
    asking --> idle: last card closes, turn over
    working --> error: turn failed
    error --> working: next turn starts
    error --> idle: reader dismisses the failure
    idle --> unknown: status lost
    working --> unknown: status lost
    background --> unknown: status lost
    asking --> unknown: status lost
    error --> unknown: status lost
```

- **Owner.** One pure classifier (`sessionActivityCategory`) over typed fields: the status booleans, the open cards, the background-work count and the activity `phase`. The chat dock, the session list, the quick switcher and the status line all use it; none has its own ladder.
- **Precedence:** `asking` > `error` > `working` > `background` > `idle`. A question waiting for the reader outranks the failure before it; the failure stays marked on its row.
- **Background work** is a count on the status, contributed by plugins (a `backgroundWork` contribution per plugin, summed by the daemon). The *category* is core. The *words* beside it ("2 background runs", "subagent: reviewing…") are the contributing plugin's appendage. A disabled plugin contributes neither count nor words.
- **Sub-flags** (`compacting`, `bash`) qualify `working`. They are not categories.
- **One `idle` per turn,** published at turn end only. `message_end` inside a turn is not idle.
- **Context usage** carries the model and window it was measured against. After a model change it is `unknown` until measured again. It is never capped to hide a wrong number (B24).

### The status line narrates; it never parrots an event word

Owner, 2026-09-30 12:06, after "message queued · 10m 51s" stood while the agent worked and two queued messages waited with no reason given: "这种不明所以的状态为什么要存在？…给用户呈现出来的，应该是一个用户可以理解的，pi web/pi正在处理的一个状态". (Why does this incomprehensible state exist? What the user sees should be a state they understand: what pi web or pi is working on.)

The status line answers three questions, every time, from live typed facts:

1. **What is being done right now:** the current **step**, with its object.
   - `thinking`
   - `writing the reply`
   - `preparing a tool call` (tool name and target, once the stream names them)
   - `running a tool` (name, target, elapsed)
   - `compacting`
   - `retrying` (attempt n of m, and why)
   - `waiting for you` (the open card)
   - `idle`
   - plugin appendages beside them
2. **For how long:** the step's elapsed time, and the turn's.
3. **What happens next** to anything the reader waits on. For example, "2 messages will be read when this step finishes" or "waiting for your answer".

The step is a state owned by the daemon, derived from pi's event pairs: `message_update` thinking, text and tool-call deltas; `tool_execution_start`/`end`; retry, compaction and card events. A step ends when its pair closes. It is never kept alive by a heartbeat, and an event word is never shown after its step ended.

## D4. The transcript viewport

```mermaid
stateDiagram-v2
    [*] --> restoring: session opens
    restoring --> following: saved position was the bottom, or none, or the anchor is gone
    restoring --> reading: saved anchor restored
    restoring --> reading: reader scrolls during restore
    following --> reading: reader scrolls up (wheel, drag, keys, scrollbar)
    reading --> following: reader scrolls down to the bottom
    reading --> jumping: reader taps back-to-bottom and the newest page is not loaded
    reading --> following: reader taps back-to-bottom (newest loaded)
    jumping --> following: newest page loaded and shown
    reading --> following: reader sends a message
    following --> following: content grows, a card opens / closes / resizes, keyboard inset changes (stay at bottom)
    reading --> reading: content grows or a page loads (keep the anchor)
```

- **Owner.** One state (`restoring` / `following` / `reading` / `jumping`) replaces `pinnedToBottom` + `viewportState`.
- **Only reader intent moves it.** Intent means a wheel, a drag that moves, keys, the scrollbar, the back-to-bottom key, or sending a message. A touch that does not move is not intent. A render-time measurement, a programmatic scroll (always tagged as ours), content growth, an image load or a page arrival never moves it.
- **The bottom** is the newest end with the newest page loaded. The bottom of an older window is not the bottom. A reader's downward scroll that lands within 48 px of the bottom counts as reaching it.
- **In `following`,** one writer keeps the bottom through any size change, using a `ResizeObserver` over the content, as `use-stick-to-bottom` does.
- **In `reading`,** nothing moves the reader: no snap on a newer page. Anchor compensation never writes during a gesture in progress.
- **No inline region traps the wheel or a swipe** (see D2).

## D5. Page sync and the socket

```mermaid
stateDiagram-v2
    [*] --> unknown
    unknown --> current: read with head
    current --> current: frame applied in order
    current --> behind: head (heartbeat, frame or read) is ahead, or T passes with nothing received, or the tab resumes
    current --> diverged: a frame or head of another epoch
    behind --> current: catch-up read joins at the old leaf
    behind --> diverged: catch-up does not join (other epoch, compaction, navigation)
    diverged --> current: tail window reloaded
    diverged --> unknown: tail reload failed
    current --> unknown: socket dead and heads unreadable
    behind --> unknown: socket dead and heads unreadable
    unknown --> behind: a head arrives
```

- **Owner.** Each surface has a head (docs/design/sync-convergence.md): the transcript `{n, leaf}`, the stream `{epoch, seq}`, and the list and card revisions. The page compares heads and never assumes.
- **Socket:** `connecting` → `open` → `closed`, plus `dead` when nothing at all arrives for 2 × the heartbeat interval.
- **A cached page is a seed,** `unknown` until the first head comparison. A persisted page and its watermark are always written together.
- **An aggregate list** (All projects) keeps one state per source. A workspace whose read failed shows as unknown with a retry; it never disappears into an empty list.

## D6. A plugin

```mermaid
stateDiagram-v2
    [*] --> disabled
    disabled --> enabling: toggled on, or process start
    enabling --> enabled: import, activate, start resolved
    enabling --> failed: a hook threw or timed out (phase recorded)
    enabling --> disabling: toggled off while enabling
    enabled --> failed: a hook threw after activation (health, start)
    enabled --> disabling: toggled off, or shutdown
    disabling --> disabled: routes stopped, in-flight aborted, cards cancelled, stop and dispose ran
    disabling --> failed: stop or dispose threw or timed out (surfaces removed anyway, phase recorded)
    failed --> enabling: toggled on again
    failed --> disabled: toggled off
```

- **Owner.** The plugin runtime of each process, reconciled against config. A toggle takes effect live (owner, 2026-09-30). In-flight work is aborted.
- For a plugin that runs in both processes, the page shows the worse of the two states (`failed` beats `enabled`) and names the process.
- **Where a plugin shows, and nowhere else** (owner, 2026-09-30: "插件声明后，出来一个新的插件的按钮点击进去是插件自定义的显示"):
  - **A page.** A declared entry in the ≡ Go to page. Tapping it opens the plugin's own page, which the plugin draws.
  - **Appendages to fixed core states:** status-line notes and counts, row actions, docked cards (D2) and a settings page.
  - Nothing else: no bars, strips or drawers over or under the transcript (rule 7). The `drawerSections` contribution point is removed.
- **Global prompts** such as an update offer are machine-scoped. The Updates plugin stores "asked for version v" per machine in its own storage and asks once per machine and version, never once per session.

## D7. A goal (our own goal plugin, replacing pi-goal's flow)

```mermaid
stateDiagram-v2
    [*] --> drafting: reader or agent starts a draft
    drafting --> active: reader confirms the draft (native card)
    drafting --> [*]: reader discards the draft
    active --> paused: reader or agent pauses
    paused --> active: reader or agent resumes
    active --> completed: auditor approves completion
    active --> abandoned: reader abandons
    paused --> abandoned: reader abandons
    completed --> [*]
    abandoned --> [*]
```

- **Focus** is a separate region: `unfocused` ⇄ `focused(session)`.
  - Focusing in another session releases the first one.
  - Focus is released only by a named arrow (focus elsewhere, pause, complete, abandon). A reconcile against a cache it cannot trust yields `unknown`, never a silent release.
  - A report ("created and focused") is derived from the stored state after the write.
- **Continuation** is a region too: `idle` → `waiting-quiescence` (no subagent run or background task active) → `injected`, or `fallback-fired` after a bounded wait.
- **The goal record format belongs to the goal plugin, and so does its reader.** Nothing else parses the files. A file that cannot be read is shown as unreadable, never as "no goals" (B27).

## Methodology folded in (research run `e7c7403c`, `uiux-methodology.md`)

- **Statecharts** (statecharts.dev; Stately testing docs):
  - each domain here is a tagged union, not a set of booleans;
  - the classifier owns events and guards, and components only execute;
  - every domain gets one table-driven test over every (state, event) pair, so an unhandled pair fails CI;
  - nothing the UI must show is a transient state.
- **Nielsen #1, #3, #4, #5** (NN/g):
  - the status line narrates (D3);
  - every mode has a visible exit (selection `✕ Done`, card Cancel, back-to-bottom);
  - one meaning per gesture on both platforms (long press selects; ⋯ is a row's actions; ≡ is navigation);
  - destructive actions are offered only in states where they make sense.
- **Mature chat apps** (Telegram `random_id` and `pts`/`seq`; WhatsApp ticks; iMessage "Not Delivered · Try Again"):
  - reconcile by client id;
  - order by server sequence;
  - a small monotonic ladder of marks;
  - failure as an actionable state on the row (D1).
- **Stick to bottom** (TanStack Virtual end anchoring; use-stick-to-bottom):
  - follow only when pinned;
  - tell user scrolls from ours;
  - keep keyed items in place on prepend;
  - do not rely on CSS `overflow-anchor`, which Safari lacks and many layout changes suppress (D4).
- **Sheets and nested scroll** (Material 3; MDN `overscroll-behavior`):
  - an inline card is a standard sheet, usable alongside the transcript;
  - its height is capped and its body scrolls inside it;
  - `contain` on a region that does not overflow blocks chaining, so it is for overlays only (D2).
- **Selection mode** (Material selection; Android contextual action mode): the contextual bar replaces the top bar; a tap toggles once in the mode; the mode exits on Done, Back or an empty selection, and after an action runs (docs/design/bulk-selection.md). Material prefers undo to confirmation; the owner chose confirmation with a count for Delete permanently, and that stands.
- **Navigation** (NN/g contextual menus and banner blindness; WCAG 3.2.3): the ≡ menu is global navigation, and plugin pages are its entries, in a stable order. Banners are ignored and take space, so none are injected (rule 7).

## Bug index

Every owner report, the domain it breaks, and its producers (file:line in the inventories).

| # | Owner report | Domain | Broken | Producers | Checklist |
|---|---|---|---|---|---|
| B1 | "Queued · 2" drawn above "Queued · 1" | D1 | pending ordered by `seq` | `userMessageRegister.ts:95-124` (source-precedence Map order); `ChatView.ts:1596-1598`; daemon status list composed lane by lane (`piSessionService.ts:6409-6420`); `restoreFront` at the head (`:3220`) | p0-message |
| B2 | an earlier message drawn below a later one (it carried a dialog) | D1, D2 | one row, placed by state | `transcriptReconcile.ts:65-86` (waiting rows appended at the end on rebuild); `userMessageRegister.ts:119-121` | p0-message |
| B3 | a consumed message still reads "Queued" | D1 | one state; `committed` and `consumed` are daemon facts; a snapshot never regresses | no `handed`, `committed` or `consumed` frame (`apiTypes.ts:1552-1554`); `messageDelivery.ts:374-380`; `userMessageRegister.ts:115-121`; commit claimed by text (`committedPromptIdentity.ts:39-45`); duplicate send answered `accepted` (`piSessionService.ts:3148-3149`) | p0-message |
| B4 | old messages suddenly reappear in the queue | D1 | a return keeps identity and times; automatic resend bounded | outbox replay (`PromptEditor.ts:1208-1246`, `pendingOutbox.ts:387-391`); `carryUnsettledForward`; take-back fallback re-mints `acceptedAt` (`piSessionService.ts:3518`); restart hand-off not shown as queued | p0-message |
| B5 | one message, two timestamps | D1 | one timestamp that never moves | `messageDelivery.ts:45` versus `:419-426` | p0-message |
| B6 | a message shown twice; states not strict | D1 | one authority | S1/S2/S8 are three authorities; no committed-entry join on rebuild | p0-message |
| B7 | a long-open page keeps hours-old rows until a reload | D5 | head compared; tail loss detected | the heartbeat `head` has no client consumer; delta replay from a stale persisted page (`sessionController.ts:1688-1734`, `:1768`) | sync |
| B8 | the All-projects list shows only pins | D5 | one state per source | `PiWebApp.ts:2855-2875` | sync |
| B9 | a terminal screen first, the native card only after Close | D2 | one native card per question | host lacks `piWebScreens` (unreleased since `.28`); `openCustomScreen` mounts the TUI (`piSessionService.ts:2127-2168`); pi-goal falls back to `select` | native-screens |
| B10 | "dialog title exceeds its length limit", invisible to the reader | D2 | a refusal is visible | `pendingExtensionDialogStore.ts:108, 300-307`; pi-goal's fallback title | native-screens |
| B11 | the wheel over a card scrolls nothing | D2, D4 | one inner region that chains | `ExtensionDialogCard.ts:514-527, 695`; `AskUserCard.ts:613-619` | native-screens |
| B12 | a special message pushes the ask card down; the reader has to scroll | D4, D2 | only reader intent releases `following` | render-time unpin `ChatView.ts:1107`; untagged programmatic scrolls `:2714`, `:2725-2726`; four writers | native-screens |
| B13 | the view jumps while the reader is above | D4 | nothing moves a reader | snap on a newer page (`viewportDecision.ts:110`); prepend settle during a gesture (`ChatView.ts:2890-2906`) | native-screens |
| B14 | the dock says working while the session is idle | D3 | one classifier; labels are output | `ChatView.ts:1942-1970, 3024` | p0-message |
| B15 | activity flaps between idle and working within a turn | D3 | one `idle` per turn | `piSessionService.ts:5558` | p0-message |
| B16 | state decided by comparing text (20 sites) | all | words are output; identity is an id | status-and-strings inventory, Scope B | maintenance |
| B17 | "Goal created and focused" but nothing is focused | D7 | a report derives from stored state; focus released only by a named arrow | `pi-goal/goal-drafting.ts:384-397`; `goal-state.ts:421`; `storage/goal-files.ts:53`; `goal-service.ts:292-303` | own-goal-plugin |
| B18 | the update prompt pops up in every session | D6 | global prompts are machine-scoped | pi-updater's per-session `session_start` prompt | updates |
| B19 | a plugin toggle needs a restart and leaves the plugin on the page | D6 | toggles are live | `serverRestartRequired`; `registry.disposePlugin` never called | plugin-lifecycle |
| B20 | core counts subagent runs | D3, D6 | the background count is plugin-contributed | `backgroundRunCount.ts:72-101` | plugin-lifecycle |
| B21 | a custom-screen redraw may not repaint | D2 | the rendered state equals the owner's | `askCardIdentity.ts:43-54` omits `lines` and `screen` | native-screens |
| B22 | a closed card is still tappable | D2 | a closed card is inert | `ChatView.ts:1821-1824` (`heldWaiting`) | native-screens |
| B23 | the Goals plugin draws a banner bar over the transcript; two header bars | D6, rule 7 | plugins show only as Go to page entries and appendages | `drawerSections` (`plugins/types.ts:375`), rendered by `ChatView.renderTopDrawer` (`ChatView.ts:1465`) | plugin-surfaces-goto |
| B24 | the context meter reads "ctx 291.5%" after a model change | D3 | usage carries its model; a mismatch is `unknown` | context usage measured against another model's window (to trace) | sync |
| B25 | "message queued · 10m 51s" while the agent works; queued messages wait with no reason | D3 | the status line narrates the step and what comes next | activity label published once at acceptance (`piSessionService.ts:3178`) and re-published by the heartbeat (`:5415-5431`) | p0-message |
| B26 | an ask answered long ago appears only now | D1, D2 | an answer is a queued message, handed at the next injection point | `submitAsk` → `sendCustomMessage(…, { deliverAs: "followUp" })` (`piSessionService.ts:1995-1997`); subsession notices likewise (`:2688`) | p0-message |
| B27 | "No goals in this workspace" while a goal is active | D7, rule 5 | the goal plugin owns its format; an unreadable file is not "none" | pi-goal appends a `# Goal Prompt` section after the JSON; `pi-web-plugins/goals/server-plugin.ts:31-40` parses the whole file as JSON, counts both as broken, and the page says "No goals" | own-goal-plugin |
| Fixed | Enter picking an IME word sent the message | composer | the IME owns its key | fixed in `3c449543` | done |
| Fixed | the row menu did not fold on a second tap; no Archive or Delete | menus | one transition per tap | fixed in `a97f6c60` | done |

## Review triage (2026-09-30)

Two lanes reviewed the first draft: closure (Opus 5.5, **FAIL**, all fixes documentary) and consistency (DeepSeek 4.1 max, **PASS WITH FIXES**). Every finding is recorded here, with what was done.

### Closure lane (Opus 5.5)

| Finding | Verdict | Disposition |
|---|---|---|
| F1 `handed` is a dead end for commands and rewritten prompts | true | **Fixed.** Added `consumed` (from `handed` and `unverifiable`), `committed` as a daemon fact through `prompt.committed`, and `[*] → committed` for entries without an id. The text claim is listed as rule-2 debt. |
| F2 duplicate, out-of-order and post-restart cells | true | **Fixed.** Rule 3 now has forward ranks and skip-forward; the ledger answers from `unverifiable`; `[*] → queued`; `handed → unverifiable` on restart; the duplicate reply carries the ledger outcome. |
| F3 `handed` and the return are unobservable | true | **Fixed.** New frames `prompt.handed`, `prompt.returned`, `prompt.committed` and `prompt.consumed`, each with `seq` and `acceptedAt`. The status list never changes state. The position is `{epoch, seq}`. |
| F4 `superseded` contradicts FIFO and the code | true | **Fixed.** Removed. The real trigger, a chat message closing the oldest ask, is a typed cancel cause. |
| F5 D2 missing close events; no plugin-card point | true | **Fixed.** Typed cancel causes, including `owner-disabled`, `daemon-restart` and `session-closed`; the waiter always resolves; a `dockedCards` contribution point through the plugin's server half. |
| F6 D3 drops `background`; `error` has no exits; out-of-turn work | true | **Fixed.** `background` drawn, with a plugin-contributed count; precedence asking > error > working > background > idle; error exits added; compaction, bash and navigation added. |
| F7 D7 is not a state machine | true | **Fixed.** D7 drawn with lifecycle, focus and continuation regions, from the owner's AGENTS.md definition. |
| F8 B24 not closed; capping would hide it | true | **Fixed.** Usage carries its model; a mismatch is `unknown`; capping is rejected. |
| F9.1 `refused` is retryable in code | true | **Fixed.** `refused → sending: Retry`. |
| F9.2 no discard exit | true | **Fixed.** `→ discarded`. |
| F9.3 automatic replay versus Retry | true | **Fixed (decided).** Automatic resend only for `notSent` records of this device under 10 minutes old; `unverifiable` records are re-asked, not resent. |
| F9.4 `queued` × daemon restart | true | **Fixed.** Queued survives, stays visible, and is handed at the next injection point. |
| F9.5 client-queued sends unmapped | true | **Fixed.** They are a persistence of `sending`. |
| F9.6 B4 citation partly stale | true | **Fixed.** Cited as the fallback path (`:3518`). |
| F10 transcript tail order undefined; dialog multiplicity | true | **Fixed (decided).** Tail order stated in D1. Every open card renders FIFO. |
| F11 D4 matrix gaps | true | **Fixed.** `restoring` exits, `jumping`, the definition of the bottom, sending a message as intent, no compensation during a gesture, a still touch is not intent. |
| F12 D5 gaps | true | **Fixed.** `current → diverged` on a new epoch, `diverged → unknown`, per-source state for aggregates, tab resume. |
| F13 D6 gaps | true | **Fixed.** `disabling → failed`, `enabling → disabling`, `enabled → failed`, the two-process rule, the B23 rule in the body, and B18's per-machine store. |
| F14 rule 2 correlation exceptions | true | **Fixed.** Named as debt in rule 2. |
| F15 refusal notice lifetime; "answered elsewhere" | true | **Fixed.** A session notification (owner, scope, dismissal); "Answered elsewhere" on a stale tap. |
| Suspicion: heartbeat budget drift | false | No change. |
| Suspicion: FIFO by seq conflicts with lanes | false | No change: every entry is `lane: "steer"`. |

### Consistency lane (DeepSeek 4.1 max)

| Finding | Verdict | Disposition |
|---|---|---|
| P1-1 `background` missing, yet called an appendage | true | **Fixed.** The category is core; the count is plugin-contributed; the words are the plugin's appendage. |
| P1-2 frames that do not exist; `acceptedAt` and `seq` not on the wire | true | **Fixed.** Named as new under rule 6: the frames, `acceptedAt` on frames and queue entries, and `seq` as a persisted inbox field. |
| P1-3 D2 and D6 both own a plugin card | true | **Fixed.** The store owns the card until it settles; disabling cancels it (`owner-disabled`). |
| P1-4 no join between `clientMessageId` and entry id after a rebuild | true | **Fixed.** `prompt.committed` carries both keys; on rebuild a pending record found on a reloaded entry becomes `committed`. |
| P2-5 `superseded` versus FIFO | true | **Fixed** (same as F4). |
| P2-6 "no nested scroller" versus the card's 60vh budget | true | **Fixed.** One capped inner region that chains at its end; `contain` for overlays only. |
| P2-7 FIFO has no daemon-side producer | true | **Fixed.** The daemon emits the list in `seq` order; the composer and `restoreFront` added to B1. |
| P2-8 an off-screen card in `reading` is invisible | true | **Fixed.** It lights the back-to-bottom key with "Waiting for you"; the reader is not moved. |
| P2-9 `{epoch, revision}` is a third ordering owner | true | **Fixed.** The status position is `{epoch, seq}`; revisions are for cards and lists. |
| P2-10 the timestamp moves and mixes clocks | true | **Fixed (decided).** Client send time for this device's sends, `acceptedAt` otherwise; it never switches. |
| P2-11 error versus asking precedence | true | **Fixed.** asking outranks error. |
| P3-12 `received` and the other browser stores unnamed | partly true | **Fixed differently.** The POST answer is itself the acceptance, so it enters `queued`; the word "Received" maps to `handed`. The pre-start queue and the outbox are persistences, not states. |
| P3-13 rule 2 versus the parsed screen | true | **Fixed.** The named permanent exception, with `unknown` falling back to the raw frame. |
| P3-14 D6 never states where plugin content lives | true | **Fixed**, and superseded by the owner's 2026-09-30 ruling: pages as Go to page entries, appendages, docked cards; no bars (rule 7). |

### Decisions taken here (the owner may override any)

1. A message's shown time is the client send time for this device's sends, and `acceptedAt` otherwise.
2. Automatic resend only for `notSent` records of this device under 10 minutes old.
3. Every open card renders, FIFO.
4. Sending a message is reader intent: the view follows.
5. Precedence: asking > error > working > background > idle.
6. The pre-owner "Received" word maps to `handed`.
