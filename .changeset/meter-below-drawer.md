---
"@gang-of-beads/pi-web": patch
---

The conversation meter stays below the session drawer's border.

The meter's opaque band poked 8px above the transcript into the open
drawer, covering the drawer's bottom border across its span - the lane
finding recorded for scheduling. The band now starts at the
transcript's own top edge, so the drawer's border line stays visible
and the two boundaries do not stack.
