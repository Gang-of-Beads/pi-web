---
"@gang-of-beads/pi-web": patch
---

A long conversation keeps loading earlier and later messages as you scroll after one of those loads fails, and after you reopen it where you left off; a failed load no longer throws away the place you reopened at. A load that keeps failing is retried at a slowing pace instead of many times a second. The back-to-newest button now takes you to the newest messages from anywhere in an older part of the conversation, and tries again by itself if that load fails; before, it did nothing there. Reload the browser to pick this up.
