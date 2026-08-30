## 1. Establish the seam and the derived enumeration

- [ ] 1.1 Route every host contribution to the agent session through one seam in the daemon's session construction, so a contribution added anywhere else cannot reach the model. Verify: a unit test that constructs a session with a contribution registered outside the seam and asserts it is absent from the prompt and tool set.
- [ ] 1.2 Derive the enumeration of host deviations from that seam - prompt additions, tool additions, tool removals, tool rewrites, tool-result rewrites - as data the tests can read. Verify: a unit test asserting the enumeration reports the two known deviations today (the session environment block; the unsupported-surface interception) without either being named by hand in the test.
- [ ] 1.3 Add the host-vs-native comparison in recording mode: construct a session over identical inputs under both hosts, diff system prompt, tool names, tool descriptions and message sequence, and report the difference without failing. Verify: `npx vitest run` on that file prints the current deviations; the recorded list matches 1.2.

## 2. Resolve every deviation before deleting it

- [ ] 2.1 Classify each row of the recorded list as enforce-in-code, document-for-the-human, or unnecessary, and write the classification into the change. Verify: every row has a disposition and an owner-visible reason; no row is left as "keep as prompt".
- [ ] 2.2 Enforce in code what the session environment block asks for: a restart of the session daemon serving the current session must refuse loudly rather than be politely discouraged in prose, and a second instance started on this instance's data dir, socket or port must fail at startup. Verify: unit tests for both refusals, each failing against current code first.
- [ ] 2.3 Move the human-facing remainder into docs/ per the documentation guide, and link it where an operator will meet it. Verify: the doc exists and README/AGENTS point at it; no prose duplicated back into the prompt.
- [ ] 2.4a RED EVIDENCE, caught live by the command ledger 2026-08-30: a goal command on a session with no focused goal crashes in the host's ui layer. Exact reproduction, no browser needed: `curl -s -X POST "http://127.0.0.1:8505/api/machines/local/sessions/01a0387f-db0f-724c-8d02-1fdc8d750716/commands/run" -H 'Content-Type: application/json' -d '{"cwd":"/private/tmp/goal-verify/t1","text":"/goal-pause"}'` returns `{"error":"Cannot read properties of undefined (reading 'input')"}`. The path runs handleGoalPause -> chooseOpenGoal (one open goal short-circuits to setFocusedGoalId) -> pauseActiveGoal/stopActiveGoal; none of those read `.input` directly, so the undefined read is in pi core's command ctx or the sessiond ui proxy - instrument the daemon-side runCommand with a caught-stack log first, then fix on the protected side. The catch currently swallows the stack; that swallowing is itself part of the defect.
- [ ] 2.4 Withdraw the unsupported-surface interception from the model's path. Whatever the browser needs to say about a surface it cannot draw is said to the human in the browser, not inserted into what the model receives. Verify: the interception no longer appears in the enumeration from 1.2, and an extension asking for such a surface still produces a visible, honest result for the reader.
- [ ] 2.5 Withdraw every host-added, host-removed or host-rewritten tool, listing for each what depended on it and how that need is met in the browser instead. Verify: the tool set handed to the model equals the native host's, asserted by name and description in the comparison test.

## 3. Close the door

- [ ] 3.1 Delete `sessionEnvironmentFacts.ts`, its test, and the code that appended it, only after 2.2 and 2.3 are green. Verify: `npm run verify` green; a grep for the block's marker finds nothing in src/.
- [ ] 3.2 Flip the comparison test from recording to failing: any deviation fails the suite and names the differing content. Verify: temporarily reintroduce a one-line prompt addition and confirm the suite fails naming it; remove it and confirm green.
- [ ] 3.3 Declare the closed set of host-injected turn kinds (continuation, notification, background report), make an undeclared kind impossible to inject, and ensure each declared kind is distinguishable from a user message where it is rendered and where it is sent. Verify: a unit test rejecting an undeclared kind, and a test asserting each declared kind carries its marker in the message handed to the model.

## 4. Evidence the owner can check

- [ ] 4.1 e2e (Playwright MCP, 8505 stack, 393×850, coarse pointer): run one seeded session to a reply and capture the exact system prompt and tool list the session was constructed with; attach them to the change. Verify: the captured prompt contains no pi-web-authored text, and the tool list matches the native host's; screenshot plus the captured artefacts.
- [ ] 4.2 Behavioural check the owner named: give the same session the same standing instruction under both hosts, drive several turns including one host-injected continuation, and record whether the instruction is still honoured. Verify: a written record of both runs with the instruction, the turns, and the outcome. This is evidence, not proof - state it as such, and do not claim the change fixed instruction-following if the record does not show it.

## 5. Gate

- [ ] 5.1 Full `npm run verify` with the exit code captured explicitly and not piped; `npx tsc --noEmit` clean. Verify: both recorded in the change with their output.
- [ ] 5.2 Confirm no protection was lost in the trade: for each row classified enforce-in-code in 2.1, point at the test that now enforces it. Verify: a row-by-row table in the change, each row naming its test.
