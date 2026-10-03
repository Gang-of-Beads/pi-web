---
"@gang-of-beads/pi-web": patch
---

Back keeps each place you opened. Opening a session right after going back to the list adds its own step instead of replacing the list's. A session that turns out to live in another workspace is opened there without an extra step. Opening a workspace from another machine's tab keeps that machine in the address even when its sessions could not be read. A browser reload picks this up.
