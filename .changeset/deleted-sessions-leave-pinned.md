---
"@gang-of-beads/pi-web": patch
---

A pinned session that was deleted, whether in PI WEB, with the pi command line, or by removing its file, is now unpinned automatically the next time the session list loads, instead of staying in the saved pins forever. Restart the PI WEB web process to pick this up.
