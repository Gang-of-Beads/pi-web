---
"@vincenthanxiaodu/pi-web": patch
---

Give the panel collapse handle a hit area you can actually hit

The control that collapses a side panel is a sliver pinned to the panel edge.
It declares 18px of width and renders at 14px - the flex host shrinks it to the
divider column - against a 24px minimum target size, with no hit area beyond
its own box. The handle stays as narrow as it looks, but now takes a 24px-wide
target so a pointer does not have to be precise about it.
