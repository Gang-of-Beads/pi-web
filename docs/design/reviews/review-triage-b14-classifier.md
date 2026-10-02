# Review triage: B14, one activity classifier on every surface

Commit `bf16c102` ("Ask the one activity classifier on every surface (B14)"). Review run `6bf7aee1`, two read-only lanes on the frozen worktree `/tmp/pw-b14`:

- Opus (`anthropic/claude-opus-5-5:medium`): OK with notes, no P0 or P1.
- DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`): OK with notes, one P1.

Every claim below was checked against the source before it was triaged.

## Fixed

| # | Finding | Lanes | Verdict | Fix |
|---|---|---|---|---|
| 1 | The state map covers only the board's sessions, while the Go to page also lists the stepped-in project's sessions (`state.sessions`) and pinned sessions whose project is closed (`pinnedElsewhere`), and the switcher lists the latter too. A session whose state is known (a create in flight, a pinned session still loaded) read `unknown` and wore no mark, while its dock said working. | Opus F1, DeepSeek P1 | TRUE (`PiWebApp.ts:2576`, `:2792`, `:2803`, `:3031`) | `sessionStateKinds` classifies every session either surface lists: the board, the pinned sessions elsewhere, and the selected project's sessions. |
| 2 | The Go to page paired the browsed machine's rows with the selected machine's statuses; the switcher already guards this with an empty map. | Opus F2, DeepSeek P2 | TRUE (`PiWebApp.ts:2806` vs `:4662`); no live collision today | The page passes no states while browsing another machine, as the switcher does. |
| 3 | D3 says `asking` outranks `error`; the classifier returned `error` first, a leftover of the four-state badge (`bfd2c3fc`) that predates the diagram. The precedence sentence had been split off its bullet onto the "Not a display state" bullet. | Opus F3, DeepSeek P2 | TRUE (`sessionActivityState.ts:31`, `state-diagram.md:223`, `:231`) | The classifier follows D3: a question waiting for the reader outranks an earlier failure. The sentence is back on the Precedence bullet. |
| 4 | "Not a display state" is wrong for the workspace roll-up: its working flag is drawn on the workspace tile. | Opus F4 | TRUE (`workspaceActivityService.ts:98`, `machineStatusService.ts:184`) | Doc corrected: the roll-up is drawn, and it answers "work a reader could stop below here", so a session being opened lights its own row but not its workspace. Behaviour unchanged. |
| 5 | `quickSwitcherSessionStates` lost its docstring to `sessionIdsIn`, inserted between them; a dock test's docstring names the deleted `activityState()`. | Opus F5, DeepSeek P2 | TRUE | Docstrings moved back and reworded. |
| 6 | `errorSessionIds` hand-rolls what `sessionIdsIn` does for the other two groups. | Opus F6 | TRUE | Uses `sessionIdsIn`. |
| 7 | The switcher row's fallback `?? (activeSessionIds.has(id) ? "working" : undefined)` is unreachable: the set is cut from the same map. | Opus F6, DeepSeek P2 | TRUE (`QuickSwitcher.ts:296`) | Fallback removed; its test now seeds the map. |
| 8 | `AppNavigatePage.test.ts:337` asserts a `.state.working` element is absent, which always passes now that the class is gone. | Opus F6 | TRUE | Assertion removed. |

## Not fixed, with reason

| # | Finding | Lanes | Verdict | Reason |
|---|---|---|---|---|
| 9 | The switcher's row slot ranks unread and a failed send above error, background and idle (`sessionRowIndicator.ts:54-61`); the Go to page draws the category only, so an unread failed session is purple in one and red in the other. | DeepSeek P2 | TRUE, pre-existing | The page has no unread or failed-send mark at all; giving it one, or taking them off the switcher's slot, is a visible change the owner has not asked for. Before B14 the page said idle there. |
| 10 | The composer's Stop (`PiWebApp.ts:4644`) tests the raw status flags, while the Stop action and reload gating use `isSessionActive`. | DeepSeek P2 | TRUE, pre-existing | Actions, not marks; outside B14. Recorded as a maintenance candidate. |
| 11 | `sessionHasActiveWork` is copied in `piSessionService.ts:6348` and `sessionCommandService.ts:490` beside `isSessionActive`. | DeepSeek P2 | TRUE, pre-existing | Daemon action gating, outside B14; changing it needs a daemon restart. Maintenance candidate. |
| 12 | `ChatView.ts:1472` builds the dock facts with conditional spreads; `turnIdle` is a three-way OR; a dock test has a conditional inside an assertion. | Opus F6, DeepSeek ponytail | TRUE, cosmetic | The spreads are what `exactOptionalPropertyTypes` asks for; a table for three members is longer than the OR. |

## Judged not a defect

| # | Finding | Lanes | Verdict |
|---|---|---|---|
| 13 | Before the first status, a session whose last activity is idle-phase shows no dock (it used to show working dots, then the idle pill). | Opus F7, DeepSeek item 2 | Intended: the state is unknown until the status arrives (D3 `unknown`). Mid-stream the dock cannot vanish: with any status the classifier answers. |
| 14 | A producer still decides a state from label words. | Both, hunt item 1 | FALSE: no surface compares a label any more. |

## Found while verifying

- **The precedence leg, live** (`probe-one-classifier.mjs`, 8505). A session opens a dialog, then its shell command fails while the phone page is open. On the build before this follow-up the phone's Go to page said "Session hit an error" and a freshly loaded switcher said "Waiting for your answer" for the same session: the open page had learned the failure from the live event, the fresh one had not. With the follow-up both say "Waiting for your answer".
- **A second producer.** A page loaded after a session failed never learns the failure: the status catalog read at boot carries each session's latest activity, and `hydrateSessionStatuses` drops it, while the live status path adopts it when the page knows none (B25). So after a reload every failed session other than the selected one reads idle in the switcher and on the Go to page. Its own commit follows this one.
