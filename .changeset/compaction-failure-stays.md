---
"@gang-of-beads/pi-web": patch
---

A compaction that fails now stays in the conversation, after a reload and on every device, with pi's reason and how full the context still is. Before, an automatic compaction that failed left nothing on the page, and a failed `/compact` left two rows that a reload dropped.
