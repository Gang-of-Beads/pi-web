---
"@gang-of-beads/pi-web": patch
---

Deleting a pinned session in PI WEB now also unpins it, instead of leaving it in the saved pins forever. A pinned session that cannot be found is still never shown under PINNED, and its pin is kept, so a session whose project keeps its sessions in a directory of its own is not unpinned by mistake. Restart the PI WEB web process to pick this up.
