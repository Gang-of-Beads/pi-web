---
"@vincenthanxiaodu/pi-web": patch
---

Messages carry an identity, so a message delivered twice is drawn once. A message reaches the browser through several independent paths — an optimistic bubble, the server's echo, the agent's committed copy, streaming deltas, a history load, the server's queue — and without an identity each path had its own test for "have I seen this?", each with a different blind spot.
