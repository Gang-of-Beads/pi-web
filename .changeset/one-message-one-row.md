---
"@gang-of-beads/pi-web": patch
---

A message you sent appears once, not twice

The browser marks its own message so the transcript does not draw it a second
time, and it does that by an id it mints when you send. Four separate places
lost that id and fell back to comparing the text instead, which fails whenever
the text is not what you typed: a slash command the runtime expands before
queueing, a message whose payload is a screenshot and carries no words at all,
and a prompt parked while the session was compacting. Pictures were dropped
from messages that had them for the same reason.

Sending a screenshot no longer produces two copies with the reply between them.
