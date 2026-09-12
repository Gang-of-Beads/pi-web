---
"@gang-of-beads/pi-web": patch
---

The transcript's top edge fades instead of slicing text mid-glyph.

Assistant surfaces are border-less, so a scrolled-out message's text cut
at the scroller's top edge read as stray lines with no boundary. A short
gradient mask makes the same clip read as intentional depth on every
surface at once.
