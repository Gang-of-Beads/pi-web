# Review triage: new sessions start on the last model; pickers open only where asked

Commits reviewed: `8c82bbff` (model default) and `c0f57922` (picker guard). Workflow `3011ae41`: lane A
daemon and pi's settings (`botim-bllm/deepseek-v4.1-flash:max`), lane B the picker guard (deepseek), lane C
full pass (`anthropic-merchant/claude-opus-5:max`). All three: OK with notes, no blocker.

## Fixed

| # | Lanes | Finding | Settled by | Fix |
| --- | --- | --- | --- | --- |
| 1 | B B-2, C P2-5 | The model picker opened without a history frame, so Back on a phone popped the previous route and left the URL naming another session (pre-existing). | `openThinkingDialog` and the theme picker push one; `onPopState` treats the model picker as a layer. | `openModelDialog` pushes the frame after the guard. |
| 2 | C P2-6 | Toggling a model's "enabled" merged the answer into whatever picker was open, another session's if the reader moved (pre-existing sibling). | `handleToggleModelEnabled` read the dialog after its await. | The answer lands only while the same machine+session is selected. |
| 3 | A F3 | A switch in a session opened earlier wrote its stale `enabledModels` whole, undoing a scope edit made since in another session. | pi merges the keys it changed but `setEnabledModels` writes the session's in-memory list. | The switch reloads the settings file first. |
| 4 | A F4, C P2-2 | A default that pi could not save (unreadable or read-only settings file) was silent: the route answered success and the next session started on the old model. | pi queues the write and keeps its errors; nothing in PI WEB drained them. | After the switch the daemon flushes, and a global-settings error becomes a `session.error` line saying the default was not saved. |
| 5 | A F1 | `config.html` lacked the section. | Read against `config.md`. | Added, with its page-nav link. |
| 6 | A F2, A 4, C Q3 | "The next new session starts on it" was untrue for forks, clones and spawned sessions, and a never-prompted session reopened later follows the default. | `sessionModelScope.ts` restores only a session with messages; spawns pass `initialModel`. | The docs say which sessions follow and which keep their model. |
| 7 | C P2-1 | The docs named `~/.pi/agent/settings.json` though `PI_CODING_AGENT_DIR` moves it. | Agent state directory section. | Named as the agent state directory. |
| 8 | C 3 | "The chosen model is added to `enabledModels`" describes a path the picker cannot take (it lists only the scope). | `availableModels` returns the scoped models. | Dropped from the docs. |
| 9 | C P2-3 | `pickerStillWanted()` mutates the request counter. | Read. | Renamed `beginPickerRequest()`. |

## Not fixed, with reason

| Lanes | Finding | Reason |
| --- | --- | --- |
| B B-1 | A route restore landing while the picker reads drops the picker. | The page did move; consistent with "another page or session". |
| B B-3 | Other dialogs that can open late: `/fork`'s entry list (the command dialog), the row-opened tree navigator, the auth dialog, plugin dialogs. | Owner question: whether the rule covers a command the reader typed. B's `/model` example is false: the daemon answers "/model is not implemented in the web UI yet" (`sessionCommandService.ts`), so it opens nothing. |
| B B-4 | Model then thinking in one tick opens only the second. | Intended: the newest picker request wins. |
| C P2-4 | Two "still wanted" idioms in `PiWebApp.ts`. | Different scopes for different callers; names now differ. |
| C P2-7 | The palette's "Select model" during a pending session start can be dropped when the id changes. | The read would have failed on the temporary id; the reader sees that error. |
| A 1, A 2, A 3 | `enabledModels` growth and project-to-global copy. | Reachable only through a direct API call with an out-of-scope model; pi's own "set as default" behaves the same. |
| A 5, C Q1 | Cycling persists, unlike pi's ctrl+p; the UI never calls the cycle route. | Owner question with the "just this session" choice. |

## Owner questions

1. pi's terminal offers "this session" or "set as default" per pick; PI WEB now always sets the default. Keep, or offer both?
2. Forks, clones and spawned sessions keep their parent's model. Should they follow the default instead?
3. Should the thinking level also carry to new sessions?
4. The default is per machine. Is that right, or should one switch reach every machine?
5. Inside a trusted project with its own default, that default wins. Keep?
6. Should `/fork`'s entry list (and the tree navigator, auth dialog) also stay closed when the reader has moved on?
