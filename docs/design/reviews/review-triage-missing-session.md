# Review triage: P2 slice a (a missing session is a typed fact)

Run cdea4bb4, two lanes on the reviewer shell:
- Opus 5.5, focused on producer coverage, 500 semantics and cached-new-session recreation;
- DeepSeek 4.1 max, a full pass.

Both used the ponytail and bob lenses. Brief: `/tmp/p2a-review-task.md`. Each claim was checked against the source before it was fixed.

## Opus lane (verdict: OK with notes)

| id | finding | verdict | action |
|---|---|---|---|
| O-P1 | Five read routes still answered 503 without the code for a missing session: subsessions, subagent-run messages and output, background tasks, background-task output | true for four, pre-existing | They answer through the same reply (404 with the code for a missing session, 503 otherwise). Background-task output reads by cwd and task id without opening the session, so its "No output for this task" 404 is correct and is left as it is. The route test covers the four; mutation-checked |
| O-P2 | A session directory the daemon could not read (EACCES, EMFILE, a flaky mount) listed as empty, so the session answered "not found", and a cached new session was recreated while the real one existed. The changeset overclaimed | true | `listSessionFiles` treats only ENOENT and ENOTDIR as "no sessions here", and passes any other error on, which becomes a 500. Gateway test with a locked directory; mutation-checked |
| O-P3a | The read and mutation replies differed only in their fallback status | true | One `sessionErrorReply(error, 400 \| 500 \| 503)` |
| O-P3b | The constant split a block in `apiTypes.ts`; stray blank lines | true | Moved after the block; the blank lines removed |
| O-P3c | The tree/fork and terminal-run `HttpError` producers in `clients.ts` dropped `code` | true | Both parse it; test for a fork of a missing session |
| O-P3d | Restore of a missing archived session now says "Archived session not found" | true, and more accurate | Kept. An old client's text match still finds "session not found" in it |
| O-P3e | The fact-wording maps are not exhaustive over the new `gone` | true, no reader today | Deferred to slice b, which presents `gone` |
| O-P3f | A daemon error with an empty message would read as "The request failed (500)" and be rewritten as a self-clearing connection problem | true | An empty reason becomes "The session daemon failed without saying why."; mutation-checked |
| O-P3g | The two flipped cached-new tests pass on HEAD, and nothing pins that a 500 carrying the old words does not recreate the session | true | New controller test: a 500 with "Session not found" does not start a new session or move the draft. It fails on HEAD, whose matcher looked at the words |
| O-P3h | The one-release legacy fallback has no tracker | true | Recorded in CHECKLIST maintenance: remove the coded-less 404 text match once a release with the code has shipped to every machine |

## DeepSeek lane (verdict: OK with notes)

DeepSeek reviewed the live tree, which by then held the Opus fixes, and verified each of them: the unreadable directory, the 503 routes, the single reply and the cached-new test.

| id | finding | verdict | action |
|---|---|---|---|
| DS-1 | The shipped notes said every other read failure is a 500, while the child-work reads keep 503 and the notification read keeps 400. A 503 from the local machine is a server error to the client, not a machine that did not answer | true | object-model §1.6, the state-diagram table and the changeset now say each route keeps its own status, and how a local 503 is read |
| DS-2 | The fact `gone` has no production producer yet: the reads that go through `classifyReadError` are collections, which never carry the code | true, by design | Slice b wires the session reads through the classifier and presents `gone` |
| DS-3 | Eight catches in `sessionRoutes.ts` still sent an empty reason through their own `errorMessage` | true | They use the shared `errorText`, and the local helper is gone |
| DS-4 | Stop and abort on a session that does not exist answer 200 "stopped" | true, pre-existing | Deferred to slice b with the presentation of `gone`: whether Stop should say the session is gone is part of that design |
| DS-5 | Two parsers of the same `code` field (`http.ts` and `clients.ts`) | true | One exported `errorCode` in `http.ts` |
| DS-6 | The reviewed diff was stale | true, process | The commit stages every file by path, including the gateway, clients, the reply refactor and this triage |

## Verification

- **Live on 8505** after a rebuild and daemon restart:
  - a missing session answers 404 `{error, code: "session-not-found"}` on messages and status, and on the `thinking-level/cycle` and `queue/clear` mutations;
  - an existing session answers 200;
  - the P1 heal probes still pass (9/9, 6/6, 10/10, 13/13, 8/8).
- **Tests:** the daemon reply table, every read route, the gateway directory case, the client code parse (http and clients), the classifier rows, the not-found table and the cached-new case. Seven guards are mutation-checked.
