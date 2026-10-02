---
"@gang-of-beads/pi-web": patch
---

A session now shows the same state everywhere. The status line under a conversation, the quick switcher and the Go to page all take it from one place, so the Go to page no longer says "idle" for a session that failed or still has background work while the switcher says otherwise, and its marks use the same colours and words as the switcher. A session whose state is not known yet carries no mark instead of a guessed "idle", and the status line no longer shows working dots for a session whose last word was "stopped" before its status has loaded.

A browser reload is enough.
