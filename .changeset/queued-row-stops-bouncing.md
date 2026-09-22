---
"@gang-of-beads/pi-web": patch
---

A queued message stops bouncing while the answer above it streams.

Growth during a turn happens inside children that render on their own, so the
transcript re-pinned its bottom only when a parent update happened to arrive:
the queued bubble was pushed down and yanked back, chunk after chunk. The
bottom is now held every frame of a live turn, for a reader aimed at it and
not while a finger is down.
