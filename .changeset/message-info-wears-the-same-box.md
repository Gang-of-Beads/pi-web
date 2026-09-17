---
"@gang-of-beads/pi-web": patch
---

The message info control wears the same box as its neighbours.

On touch it was a borderless glyph beside two bordered buttons, so it read as
a stray mark rather than a control, and the inherited line-height plus the
right-aligned text pushed the ink off centre. It now draws the same 22px
bordered square with the icon centred, measured identical to the retry and
copy buttons in the same header.
