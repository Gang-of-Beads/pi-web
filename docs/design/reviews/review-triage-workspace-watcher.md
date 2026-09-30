# Review triage: the workspace watcher publishes real changes only

Change: object model §1.16, following research run `8f558e71` (VS Code's git extension, GitLens). Review run `bd824781`: Opus (`anthropic/claude-opus-5-5`) and DeepSeek (`botim-bllm/deepseek-v4.1-flash:max`), with the bob and ponytail lenses.

Why: on 8504 (2026-09-30), git status and tree reads were 74 % of all requests, and the session daemon ran at 99 % CPU with a 2.2 GB heap.

Live on 8505 (`scripts/probe-watch-noise.mjs`, desktop, Git panel open on a git workspace with a session held there):

| | old daemon | new daemon |
|---|---|---|
| precondition: the watch is live | 11 frames | 1 frame |
| `workspace.changed` frames during 15 s of git churn, `node_modules` and task logs | **39** | **0** |
| a file written outside PI WEB shows in the Git panel | 112 ms | 2.6 s (tree window 2.5 s) |
| committing it clears it from the panel | 213 ms | 424 ms (git window 250 ms) |
| Git panel reads at open | 15 | 1–2 |
| a linked worktree's git state (its index under the main repository) publishes | never (0 frames) | yes (1 frame, within 1.5 s) |
| legs passed (final probe) | 5 of 7 | 7 of 7 |

## Opus lane (verdict: OK with notes)

| id | finding | verdict | action |
|---|---|---|---|
| O-P1 | The probe's noise leg counted HTTP reads, which the Git panel's 8 s poll also makes, and did not check that the watch was live | true | Fixed. The probe counts `workspace.changed` frames on the daemon's own socket, after a precondition that a tree write publishes. Old daemon 39 frames, new 0 |
| O-P2 | The tree exclusions and several throttles in §1.16 are claimed but not shipped | true | Fixed in the doc. §1.16 now separates what ships from what is still to do (P3). Build output is news on purpose; a `.gitignore` check costs a spawn per event and waits for a measurement |
| O-P3a | `worktrees/**` whitelisted wholesale lets log noise and other worktrees' state through | true | Fixed: removed from the whitelist; test cases added |
| O-P3b | Wall-clock `now()` | true | Fixed: `performance.now()` |
| O-P3c | The client's hidden-tab wiring has no test | true | Fixed. A PiWebApp test: hidden, two events, no refresh; shown twice, one refresh. It fails when the call is removed (mutation checked) |
| O-P3d | A nested clone's `.git` counts as tree | true | Fixed: noise; test cases added |
| O-tests | Missing table cases | true | Added: worktree logs and index, a nested `.git`, `.git` alone, a backslash path, and a later-due change keeping an earlier publish |

## DeepSeek lane (verdict: OK with notes)

DeepSeek reviewed the live tree, which by then held the Opus fixes, so it re-found none of them.

| id | finding | verdict | action |
|---|---|---|---|
| D-1 | A linked worktree keeps its index and HEAD under the main repository's `.git/worktrees/<name>`, outside the watched folder, so a terminal commit there never publishes | true, pre-existing, and it contradicts the new "a commit shows at once" | Fixed: `hold` reads a `.git` file's `gitdir:` and watches that directory too, as the workspace's `.git`. A test (fails without it) and a live probe leg on the 8505 worktree |
| D-2 | The `.pi` noise rule was root-anchored, so `.pi/sessions` and nested `.pi/tasks` still publish | true | Fixed: `.pi/{tasks,delegate,sessions}` at any depth; table rows added |
| D-3 | No changeset | true (the diff it saw was stale) | `watcher-ignores-noise.md` |
| D-4 | A submodule's git state under `.git/modules/` was dropped | true, narrow | Fixed: `.git/modules/<name>/…` follows the same rules, recursively; rows added |
| D-5 | Probe hygiene: the socket was not closed on failure, no visibility precondition, the wrong env name, commits left in the fixture repo | true | Fixed: the socket closes in `finally`, a visible-page precondition, `PI_WEB_PROBE_BASE`, `homedir()`, and the fixture is reset to its starting commit |
| D-6a | `release` and `dispose` cancel a pending publish, now up to 2.5 s wide | true, by design | Unchanged: watches are hints, and a released workspace has no reader |
| D-6b | Returning to the tab can invalidate twice | true | Unchanged: the git panel is single-flight and the explorer is generation-guarded, so reads are not doubled (checked) |
| D-6c | sync-convergence says 2 s | true | Fixed: it says 250 ms and 2.5 s, and points to §1.16 |
