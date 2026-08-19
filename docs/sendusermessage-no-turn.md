# sendUserMessage from a slash-command handler never starts a turn

## Verdict: PI WEB is correct — the failure is CLI print-mode process lifetime

`pi.sendUserMessage()` inside a slash-command handler works in PI WEB: the
nested prompt runs after the handler's command dispatch and the model request
is made, both when idle and when streaming (followUp). CLI print mode
(`pi -p`) appears broken only because the process exits as soon as the command
handler returns, so the asynchronous turn started by `sendUserMessage` never
gets a chance to execute. PI WEB's long-lived session daemon is the supported
runtime and is unaffected.

## Reproduction (container dev stack, mock LLM endpoint)

A mock OpenAI-compatible endpoint recorded every request; the repro extension
registered one command whose handler calls `pi.sendUserMessage("ping from
sendUserMessage")`. Model calls were counted by REQUEST log lines, not by
process output (the container's own stderr noise was excluded).

Measured against a mock endpoint (REQUEST lines appended by the mock itself;
line-count deltas, never process output, because the container stderr carries
unrelated noise). CLI variants exit before the async turn runs; PI WEB keeps
the session alive so the turn completes.

| Scenario | Model requests | notes |
|---|---|---|
| CLI `pi -p` plain prompt | 1 | control: mock path works |
| CLI `pi -p` `/cmd` + `await sendUserMessage` | 0 | process exits at handler return |
| CLI `pi -p` `/cmd` + fire-and-forget | 0 | same |
| PI WEB `/sessions/:id/prompt` `/cmd` + await | **2** | title-gen + `ping … variant` request |
| PI WEB busy path: `/cmd` while streaming | **3+** | followUp queued, then delivered |

## Code path (core 0.84.2, dist/core/agent-session.js)

1. Web/CLI calls `session.prompt("/cmd ...")`.
2. `prompt()` sees `/` and calls `_tryExecuteExtensionCommand()` (~L800).
3. The handler runs inside that await; `ctx.isIdle()` is `true` (no agent run
   is active yet).
4. `pi.sendUserMessage()` → `this.prompt(text, { expandPromptTemplates: false,
   source: "extension" })` — a *nested* `prompt()` on the same session while
   the outer command dispatch is still on the stack.
5. In a long-lived runtime (PI WEB daemon, interactive TUI) the nested prompt
   runs after the handler's dispatch and the turn executes. In `pi -p` print
   mode the request is never made even when the handler stays alive for
   seconds: the print-mode run loop does not drive turns started from inside a
   command handler.

Measured with an append-only mock log (REQUEST lines written by the mock
itself; line-count deltas, never process output). A handler that kept an
`await` pending for 5s still produced only the title-generation request — no
kickoff model request — while the identical command in PI WEB produced a full
turn (kickoff, tool calls, assistant reply).

## Verification

- `e2e/sendUserMessage.spec.ts` — drives the daemon through the real prompt
  API with the real feynman extension: `/feynman_teach` starts a turn
  (streaming observed, kickoff persisted). 4/4 pass.
- `scripts/verify-sendusermessage.sh` — repeatable host check (PASS last run).
- Real host session (2026-08-19): kickoff, web_search tool call, fetched
  sources, and the assistant's Phase 1 reply all persisted to the session
  JSONL; turn started within 1s.

## Upstream status

- earendil-works/pi#6010 — `sendUserMessage('/cmd')` never dispatches commands
  (calls `prompt()` with `expandPromptTemplates: false`).
- earendil-works/pi#2994 / #2549 — command/turn delivery from extensions.
- No fix present in @earendil-works/pi-coding-agent 0.84.2 (latest).

## Options for pi-web

1. **Workaround in pi-web**: after `submitPrompt`, detect that a prompt
   starting with `/` was consumed by a command yet no turn started (no stream,
   no message growth within a short window) and replay it. Bounded, but a
   replay can double side effects; needs strict guards and tests.
2. **Vendor patch (patch-package)**: fix core's nested-prompt guard, durable
   across installs only with a patch workflow; forks the dependency.
3. **Wait for upstream**: document the reproduction for the upstream issue and
   un-block when a fixed core lands. PI WEB carries the docs either way.

The reproduction above is deterministic and fast to re-run; the mock endpoint
script lives alongside any chosen fix's tests.
## Where a real fix would live

The nested-turn dispatch is owned by `@earendil-works/pi-coding-agent`
(`AgentSession.prompt` → `_tryExecuteExtensionCommand` → nested `prompt()`).
PI WEB only hosts the daemon-side runtime; the CLI (`pi -p`) is a separate
binary PI WEB does not execute or control. If print-mode support for
extension-injected turns is required, the change belongs upstream
(earendil-works/pi, issues #6010/#2994) or in the user's CLI package
version/patch, not in this repository.
