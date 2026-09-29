---
"@gang-of-beads/pi-web": patch
---

A session no longer flips back to "idle" while the agent is working because a slow status reply arrived after a newer live update, and a message still waiting in the queue no longer disappears from the conversation when the page catches up after a reconnect.
