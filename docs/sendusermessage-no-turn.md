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
5. The nested prompt should hit the idle path (`_runAgentPrompt`, ~L919) but
   never does: no error, no queue, no model request, message may appear in
   agent state yet the turn machinery is skipped.

Early runs reported "0 requests" across the board; that was a measurement
artifact (the mock's log file was deleted under it, so later appends went to an
unlinked inode). Re-measuring with append-only logs and line-count deltas shows
PI WEB delivers the nested turn. What remains is print mode, where the process
lifetime excludes any work scheduled after the command handler returns.

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