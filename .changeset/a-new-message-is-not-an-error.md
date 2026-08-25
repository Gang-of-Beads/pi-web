---
"@vincenthanxiaodu/pi-web": patch
---

Stop reporting a normal message as a fault. A message just typed into this browser has no server metadata yet, and the header said so out loud — "No Pi message metadata available", in the place a timestamp normally sits, on every queued message and every message whose send had failed. Having no metadata yet is that message's ordinary state, not something worth announcing, so the header now says nothing at all until there is something to say.
