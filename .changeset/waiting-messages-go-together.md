---
"@gang-of-beads/pi-web": patch
---

Messages that wait for the agent now reach it together. When a run ends, or a session reopens after a restart, everything that waited is sent in one request, in the order you sent it, so the agent answers them once instead of once per message. An extension command still waits its own turn.
