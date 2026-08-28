---
"@vincenthanxiaodu/pi-web": patch
---

Open a subagent run as the conversation it is, and say where its limits are.

A subsession row opened the session it named while an agent-run row only ever
offered a block of text — the same work told two different ways. The row now
opens the child's own conversation: its turns, its tool calls, and its thinking,
drawn by the same renderers the transcript uses. Both kinds of child arrive the
same way, whether the run kept a session file or the subagent tool's event log.

The view names the run it belongs to and offers a way back, because it sits over
a different conversation and must not be mistaken for the one underneath.

It reads and does not steer. Steering, resuming and interrupting a live child
travel over the subagent extension's RPC on the in-process Pi event bus
(`pi.events`), which the web server does not hold, so the view says so rather
than offering a control that would do nothing. The bridge is not impossible —
the session daemon hosts the agent process that loaded the extension — but it
belongs on the daemon's socket rather than in the browser.

The log viewer stays where a log is genuinely a file: background task output,
and runs that ended without writing a transcript at all.
