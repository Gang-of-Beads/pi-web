---
"@gang-of-beads/pi-web": patch
---

The two side panels default to the same width.

The navigation panel was a fixed 340px while the workspace panel
defaulted to minmax(340px, 32vw) - on a common desktop the right panel
opened a hundred pixels wider than the left for no reason. Both now
default to 340px; resizing still works within the existing limits.
