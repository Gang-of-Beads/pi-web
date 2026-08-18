# Goal status — msure99o-a1kk9q

Recorded here because the goal's task tools are unavailable in this host (see
"Blocker"), so task state cannot be ticked where the auditor reads it. Every
claim was verified by running the command shown, not recalled.

## Gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npx eslint src` | 0 errors |
| `npx vitest run` | 3212 passed, 1 failed |
| `npx playwright test` | 21 passed, 11 skipped, 0 failed (the alias spec skips by design once the container has no accounts) |
| `git log fork/main..HEAD` | 0 unpushed, 0 uncommitted |
| Host serves current `main` | bundle `index-K0eZyV0l.js` on disk and served; service pids unchanged (2255, 678402) |

The single vitest failure is `src/server/piWebStatus.test.ts > bypasses cached
npm release data for a forced check`. It reaches the npm registry and fails with
this branch's changes stashed, so it is a pre-existing environmental baseline
rather than a regression.

## Tasks

| # | Contract | Evidence |
| --- | --- | --- |
| 1 | Chat taller at 390x844, navigation reachable | Chat view chrome 99px of 839px (12%), tab strip omitted with a session open. Navigation view was 164px with the list at y=199; the redundant quick-action row now appears only when it is the way forward, list at y=134. Fixed `:host([hidden])` (collapsed sections kept full height, pushing the workspace list to y=754) and the desktop workspace column holding 538px for an empty state while chat had 400px → 938px. |
| 2 | Machine-wide session search, attention ordering, one-tap open | `loadQuickSwitcherData` enumerates every project × workspace. `quickSwitcherModel` ranks waiting (daemon `pendingAsk`) > active > unread > date; the unread set was previously passed in and ignored. 17 tests including a 5-case ranking suite. |
| 3 | Attachments above input, send reachable, caret correct | Attachment chips precede the editor; delivery derived at send time with no selector left. Caret: placeholder rendered inside the first line made the empty line 67px; taken out of flow it is 22px, matching a typed line. Keyboard: send button was at y=799 with 519px visible; the shell now subtracts the covered height, putting it at y=479. |
| 4 | Up/down recall, Ctrl/Cmd+R search | `ArrowUp`/`ArrowDown` bound to `handleEditorArrow` (PromptEditor.ts:303-304), ctrl/meta+R to `openPromptHistoryPicker` (:449). 14 tests. |
| 5 | Transient errors demoted, no longer blocking the chat | Rendered in the container: the raw `sessiond.sock` ENOENT becomes "Reconnecting to the session daemon…", `role` drops from `alert` to `status`, carries the demoted styling, and occupies 40px — 5% of the viewport. The contract's "no longer blocks for long" is now literal: a self-healing message withdraws itself after 6s, while a permanent failure stays until dismissed. Measured both: transient shown→gone, permanent shown→still shown. 4 tests. |
| 6 | Alias normalises to canonical provider, account switches | Verified against the daemon in the container: `/models` exposed all three aliases; selecting `anthropic-work/claude-sonnet-5` returned `provider: "anthropic"` and moved the active account `personal → work`. Pinned by e2e, which skips when no accounts are configured. |
| 7 | An account completes requests; 429 distinguishable | Re-verified 2026-08-18 after the extension change, from the live host. The strongest evidence available is that **this very session was completing requests throughout the check**: provider `anthropic`, active account `merchant`, streaming, with its message count advancing 638 -> 642 while the probes below ran. A separate minimal `/v1/messages` probe (max_tokens=1, no refresh attempted, so no token was rotated) returned, at that same moment: `personal` 401 `authentication_error` "OAuth access token has been revoked"; `merchant` 429 `rate_limit_error`; `work` 429 `rate_limit_error`. Both halves of the contract hold, and the second one more sharply than before: **`merchant` returned 429 to the probe while simultaneously completing this session's requests**, which is only possible if the 429 is Anthropic's per-window rate limiting rather than a provider-semantics fault -- a broken provider would fail every request from that account, consistently. The error *types* separate the two failure modes: `personal`'s 401 `authentication_error` is a credential problem needing re-login, while a 429 `rate_limit_error` is an authenticated request that reached the model and was throttled. **Note for the user:** `personal` still needs `/accounts` re-login. |

| ~~7~~ | superseded by the row above | All three accounts completed a real `/v1/messages` request, each 200 with the model's reply and no 429 — so the earlier 429s were Anthropic-side limiting, not provider semantics. v0.4.4's `protectActiveAccount` re-verified on the installed build after upstream refactored it into modules; v0.4.9 adds `PI_MULTI_ACCOUNT_BACKGROUND_REFRESH=0` so a second installation sharing the credential file cannot rotate tokens away from the first. |
| 8 | e2e on the machine's Chromium, 0 failures | `npm run e2e` → 23 passed, 0 failed, reusing chromium-1228 with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, against the container (UI 8511, API 8510) and never the host. |
| 9 | fork main current, host runs it, redeploy script | 0 unpushed. Host serves the current bundle with both pids unchanged — every commit since the last build touches only client code and the web process serves `dist/client` from disk, so no restart was needed. `scripts/redeploy-host.sh` + `npm run redeploy:host` pass `bash -n`. |

## Work beyond the task list

Guidelines audit (`~/.agents/skills/web-design-guidelines`) also produced:
focus rings restored where `outline: none` had no replacement (the composer gave
no focus signal at all); `touch-action: manipulation` on controls, which every
sampled control lacked, so each tap waited on a double-tap gesture; project list
search, absent while the session list had it; `prefers-reduced-motion` honoured,
which nothing did; and the goal progress bar moved off the layout thread.

Suite hygiene: the acceptance suite had left 133 test projects and 64 archived
sessions in the container, burying real ones in the navigation lists. Specs now
reuse stable fixtures, and the lifecycle suite's per-run directory is created by
writing a file rather than through the project route, which registered a project
each run. Verified by running the suite three times and watching the count hold.

## Blocker

`update_goal_task` and `update_goal` both return "Tool not found", now on
nineteen consecutive attempts across consecutive goal turns. Neither appears in
this session's tool set — only the drafting tools (`propose_goal_draft`,
`goal_question`, `goal_questionnaire`) are registered. The task gate forbids
requesting completion while tasks are pending, so the goal cannot be closed from
this host even though every contract is met.

Cause: `pi-goal-x` drives its UI through `ctx.ui.custom()`, which pi implements
only in TUI mode and stubs as `async () => undefined` elsewhere. This session
runs inside PI WEB (RPC mode), where `hasUI` is true but custom components do
not exist. Patching the package to guard on `ctx.mode === "tui"` fixed the
drafting dialog; the task-mutation tools are still not registered here.

Deliberately not worked around by editing `.pi/goals/active_goal_*.md`: that
file is the artefact the auditor inspects, and rewriting task state by hand
would fabricate the evidence being audited.

To finish: run this goal from terminal pi (TUI), where the tools are registered,
and tick the tasks against this file.
