# sendUserMessage from a slash-command handler never starts a turn

## Verdict: reproduced, root cause is in the pi coding agent core

`pi.sendUserMessage()` called from an extension slash-command handler while the
session is idle does **not** start an agent turn. The user message is accepted,
`sendUserMessage` resolves without throwing, but no model request is ever made
and no assistant reply is produced. Reproduces in the PI WEB UI (`/sessions/:id
/prompt`) and in CLI print mode (`pi -p`), with any provider.

## Reproduction (container dev stack, mock LLM endpoint)

A mock OpenAI-compatible endpoint recorded every request; the repro extension
registered one command whose handler calls `pi.sendUserMessage("ping from
sendUserMessage")`. Model calls were counted by REQUEST log lines, not by
process output (the container's own stderr noise was excluded).

| Scenario | Model requests | stdout | handler logs |
|---|---|---|---|
| Plain prompt `say hi` (control) | **1** | `mock reply` | — |
| `/cmd` handler `await sendUserMessage` (idle) | **0** | empty | handler ran, resolved, no error |
| `/cmd` handler `pi.sendUserMessage` (no await) | **0** | empty | handler returned |
| `/cmd` handler `await ctx.waitForIdle()` then send | **0** | empty | resolved, no error |
| PI WEB `/sessions/:id/prompt` with `/cmd` | **0** | `accepted:true` | same |

Control confirmed the mock path works: a normal prompt produces exactly one
model request and prints the reply. Every slash-command variant produces zero.

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

The single-dot difference from a normal prompt is the nesting: sendUserMessage
from a command handler races the outer `prompt()`'s command dispatch. The
interactive TUI is the only place the official `/ask` example is exercised,
which is why this has been a known issue family upstream rather than a loud
failure.

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