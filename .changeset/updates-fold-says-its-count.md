---
"@gang-of-beads/pi-web": patch
---

The Updates fold says how many messages it holds.

The fold migration claimed Updates showed its message count as the collapsed
summary, but the panel only ever registered a badge, so the summary read empty
on a collapsed tool. It contributes the count as a summary now, and the menu
probe additionally asserts the context path it was blind to.
