---
"@gang-of-beads/pi-web": patch
---

A waiting card can be read to the end, and reading holds its place

A card asking a question was held outside the transcript with a height budget,
so on a phone its own confirm buttons fell past the fold and the page would not
scroll to reach them. It is now the last row of the transcript, in normal flow,
with nothing pinned inside it, so it can be read at any length.

Separately, growth above the viewport used to move a reader who had scrolled up,
because this scroller turns off the browser's own scroll anchoring. A reader who
is not pinned to the bottom now keeps their place while new content arrives.
