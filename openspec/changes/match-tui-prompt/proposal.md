## Why

The same model follows instructions in the native pi TUI and does not in pi-web.
The owner has watched it hold a rule for an hour in the terminal and improvise
against the same rule here, repeatedly, in one working day.

pi-web is a browser front end for an agent. It is not entitled to change what
the agent is. Today it does: it appends its own block to every session's system
prompt (`sessionEnvironmentFacts.ts`, delivered as `<pi_web_session_environment>`),
and it adds host-specific surface around the model that the terminal host does
not. Every addition competes for the model's attention with the user's own
instructions, and the user's instructions are the ones that lose.

The owner's decision, stated plainly: **pi-web must not modify anything about
the model, and must be identical to the native pi TUI.** No appended prompt, no
host-added tools, no host-shaped context. What the model receives in pi-web is
what it receives in the terminal - not similar to it, the same.

That is a testable claim, and this change is not done until it is tested as one:
for the same session inputs, the system prompt, the tool set and the message
sequence handed to the model must be equal under both hosts, and a difference
must fail the suite rather than be argued about.

## What Changes

- **BREAKING** The session environment block is no longer appended to any
  session's system prompt. Sessions get the prompt the native host builds and
  nothing more.
- **BREAKING** Every tool pi-web adds to, removes from, or rewrites in the
  agent's tool set is withdrawn. The tool set is the native one.
- Every other place where pi-web shapes what reaches the model - injected
  turns, rewritten tool results, appended context, altered defaults - is
  enumerated and removed. The implementation must produce that enumeration
  first; a change that removes only the two known additions has not done the
  work.
- Anything pi-web genuinely needs the agent to know (that it runs inside a
  session daemon, that restarting the daemon kills the session) stops being a
  prompt for the model and becomes either a guard in the code or documentation
  for the human. A rule the software can enforce must not be spent as prompt.

## Capabilities

### New Capabilities

- `host/model-neutrality`: what pi-web guarantees about the agent it hosts -
  that the model's prompt, tool set and context are the native host's, and what
  the host may do instead when it needs a behaviour.

### Modified Capabilities

None. No existing spec describes what the host may send to the model, which is
how it came to send whatever it liked.

## Impact

- `src/server/sessions/sessionEnvironmentFacts.ts` and its test - deleted, with
  the knowledge they carried moved into guards or docs.
- `src/server/sessions/piSessionService.ts` - where the block is appended and
  where the session's services are constructed.
- Any host-registered tool or tool wrapper in `src/server/sessions` and
  `src/server/sessiond`, including anything that intercepts an unsupported
  surface and answers on the model's behalf.
- The daemon protections that the deleted prompt used to ask for politely must
  exist in code before the prompt is removed, or removing it trades a weak
  safeguard for none.

## Non-goals

- Removing pi-web's own UI affordances. This is about what reaches the model,
  not about what the browser shows the human.
- Changing extension behaviour. Extensions run in the native host too; if an
  extension asks for a surface this host cannot draw, that is the separate
  `ui.custom` question and is not settled here.
- The goal plugin's continuation injection. It is a legitimate producer of
  turns and is owned by its own change; it is listed here only so the
  enumeration does not silently skip it.
