---
"@gang-of-beads/pi-web": patch
---

The transcript's top edge fades instead of slicing text mid-glyph.

Assistant surfaces are border-less, so a message clipped by the chat's
top edge read as stray floating text with no boundary (the owner's
"this is a bug?" screenshot). A short mask fade at the scroller's top
makes the same clip read as intentional depth on every surface.
