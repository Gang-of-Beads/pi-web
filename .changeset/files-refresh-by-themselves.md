---
"@gang-of-beads/pi-web": patch
---

The Files page refreshes by itself every few seconds while it is on screen, as Git already did, so a change shows even when the file watcher misses it. A file open in the viewer now shows its new content when it changes on disk. Neither reads while the page is off screen or the tab is hidden.

A browser reload is enough.
