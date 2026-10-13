---
"@gang-of-beads/pi-web": patch
---

A new session nobody has written in yet stays in the session list after you leave it, on every device, marked "not started". pi writes a session's file only at its first message, and the list was read from those files, so a new session disappeared from the list once you left it. Such a session lives only in the session daemon until its first message: a daemon restart drops it.
