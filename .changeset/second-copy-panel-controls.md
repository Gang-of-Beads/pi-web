---
"@gang-of-beads/pi-web": patch
---

When two machines each bring their own Files, Relays or Tasks plugin, each machine's Refresh, Upload, stale mark and Tasks warning now act on that machine's own panel. Before, the copy loaded second sent them to a panel it could not reach, so they did nothing. A browser reload is enough.
