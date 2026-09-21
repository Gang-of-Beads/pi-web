---
"@gang-of-beads/pi-web": patch
---

A native light theme, and an icon that follows it.

The core had a light palette all along, reachable only by changing the
system preference: it is now a card of its own, "Pro Light (native)", so a
phone in dark mode can pick it. The tab icon follows whichever look is
active - the pi glyph typeset in the product mono face, coloured by the
palette - and a theme plugin may declare its own icon instead.
