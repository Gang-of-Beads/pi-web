---
"@gang-of-beads/pi-web": patch
---

The panel fold survives reload.

Folding the navigation or workspace panel was memory-only, so every refresh
handed the screen back exactly the way it was before the reader folded it -
the reshuffle that made reloads feel wrong. The fold is now a stored layout
preference (a global key: it is about the reader's screen, not about any
machine's or workspace's data) and is restored before the first render.
Storage being unavailable costs nothing but the persistence.
