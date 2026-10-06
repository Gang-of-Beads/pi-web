---
"@gang-of-beads/pi-web": patch
---

The Background, Subagents and Info pages now draw their rows the same way: each section is one rounded group with a line between rows, a coloured dot and word for a status (green for running, amber for attention, red for a problem), and a muted line under each row. A page with nothing to show says so in one box in the middle of the page. Plugins can draw their own status pages this way through the host's new `renderList`. Reload the page to pick it up.
