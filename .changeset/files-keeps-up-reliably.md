---
"@gang-of-beads/pi-web": patch
---

The Files page keeps up more reliably while you watch it. A file open in the viewer no longer jumps back to the top when the agent rewrites it; your place and selection stay. Deleting a folder you had expanded no longer freezes the tree. A file that failed to load once is tried again. "Out of date" now stays until a read has actually brought the current files, instead of going away after a read that failed. On a slow machine, reads no longer pile up and overtake each other.

A browser reload is enough.
