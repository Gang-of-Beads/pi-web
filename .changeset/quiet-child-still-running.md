---
"@vincenthanxiaodu/pi-web": patch
---

Stop declaring a thinking subagent dead. Liveness was inferred from how recently the child wrote its transcript, with a ten-minute window — but a child writes only when it calls a tool, so four reviewers reading a long document (silent for 15 minutes) were all reported as `unknown` and the drawer said "Nothing running right now" while they worked. Whether the parent turn is still running is a fact rather than an inference, and it now settles the question: a run with no result, spawned by a turn that has not returned, is running. The mtime window remains only as the fallback for a run whose parent has already gone idle.
