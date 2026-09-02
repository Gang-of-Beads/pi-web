---
"@gang-of-beads/pi-web": patch
---

Scrolling back through a long session stays where you put it

Holding your reading position was measured on every frame, which on a long
transcript meant walking every message and forcing a layout several times a
second while a reply streamed. The transcript crawled, never quite reached the
bottom, and snapped back under your thumb. It is now measured only when
something above you can actually have moved, and never while your finger is
still on the screen.

Screenshots load lazily, so scrolling back decodes them as they appear. One
finishing above you used to carry the page down with it, because the scroller
turns off the browser's own anchoring and nothing else put your place back.
