---
"@gang-of-beads/pi-web": patch
---

A delivered message stops asking to be sent again.

When the daemon accepts a prompt the outbox entry is retired, so a send that
reported a failure while the request actually landed no longer offers Retry
for a message the agent has already answered. The undelivered strip is also a
box of its own instead of loose text continuing the transcript.
