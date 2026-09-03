---
"@gang-of-beads/pi-web": patch
---

Message card corners cannot break any more: the card clips its children
instead of trusting them to replicate its curve. Every earlier fix needed two
drawings of the same arc to agree - a sticky header guessing the card's inner
curve, latterly through a token in one file consumed by CSS in another. One
arc, one owner, one file now, with a graceful fallback for browsers that do
not parse overflow: clip. Verified pixel by pixel at three device pixel
ratios with a probe-owned palette, against both failure shapes, on every
card type.
