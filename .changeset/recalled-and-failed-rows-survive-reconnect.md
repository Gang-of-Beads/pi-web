---
"@gang-of-beads/pi-web": patch
---

A message you recalled while the connection was down no longer comes back after the reconnect, and a "Not received · Retry" message no longer disappears when the page catches up. Right after a daemon restart, a message still waiting in the queue is no longer briefly marked as not received.
