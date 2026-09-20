---
"@gang-of-beads/pi-web": patch
---

A row menu opened beside a narrow tile stays on screen.

Right-aligning the panel to its trigger assumed the trigger had 240px of room
to its left. On the two-column board at 393px it does not, so the panel hung
off the left edge with half its items unreadable. When there is not enough
room beside the trigger the panel sits inside the bounds instead.
