---
"@gang-of-beads/pi-web": patch
---

A slash command answer reaches the screen.

ui.notify from a command wrote to the notification store, and nothing read that
store - so /goal-list settled to "Read" with no list anywhere. The answer is
published to the transcript as well, on its own visible row.
