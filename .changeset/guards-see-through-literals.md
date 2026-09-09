---
"@gang-of-beads/pi-web": patch
---

The scale guards now see through the places literals were hiding: spacing
inside `calc()`/`max()` and negative offsets, sizes inside a `font:` shorthand,
and the focus ring's width. Seventy-five hidden spacing values, forty-six font
shorthands and eighteen ring widths read their tokens instead. The panel-header
token equals the control height it contains, so the navigation rail and the
chat drawer draw one horizontal rule instead of 44px beside 40px; the cleanup
entry keeps the mouse control height; and the multi-select checkbox is
concentric with the subtree toggle it shares a slot with.
