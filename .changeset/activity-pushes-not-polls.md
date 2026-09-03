---
"@gang-of-beads/pi-web": patch
---

Starting a subagent or background task now tells the browser. The daemon publishes an activity change the moment such a tool starts or ends, and the activity panel refreshes on the event instead of waiting for a poll that was gated by luck.
