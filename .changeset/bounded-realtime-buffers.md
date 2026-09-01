---
"@vincenthanxiaodu/pi-web": patch
---

Bound session replay memory and disconnect slow realtime clients so long-running daemons recover through reconnect/resync instead of accumulating buffered data.
