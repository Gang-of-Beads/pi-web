---
"@gang-of-beads/pi-web": patch
---

Back keeps each place you opened. Opening a session right after going back to the list adds its own step instead of replacing the list's. A session that turns out to live in another workspace is opened there without an extra step. Opening a workspace from another machine's tab keeps that machine in the address even when its sessions could not be read. Switching machines keeps your previous place one Back away, and a tap you overtake with another no longer leaves a step of its own. A session found in another place after you went back no longer pulls you to it. A browser reload picks this up.
