---
"@gang-of-beads/pi-web": patch
---

A session deleted while you have it open, for example on another device, now says "This session no longer exists on <machine>." with a way back to the workspace's sessions, instead of "Couldn't load this session." or a notice beside a transcript that could no longer be written to. The same holds when you pick a row from a list read before the session was deleted, and when you press Stop on it. If it was archived rather than deleted, it opens read-only. An archived session now says "This session is archived." with a Restore button where the composer would be, instead of a disabled composer. Stop on a session the machine no longer holds now says so rather than reporting success (this needs the session daemon restarted).
