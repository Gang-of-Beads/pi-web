---
"@gang-of-beads/pi-web": patch
---

After a reconnect, a message still waiting in the queue stays one row and still reads "queued". It no longer shows twice or reads "delivered" before the agent has read it. Also fixed:

- A reply can no longer appear in the wrong session after you switch sessions during a reconnect.
- Right after a daemon restart, a queued message is no longer briefly marked as not received.
- A refused message no longer turns "delivered" because a different message with the same words arrived.
- Text streamed by a restarted daemon is no longer dropped.
