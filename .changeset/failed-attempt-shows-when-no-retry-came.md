---
"@gang-of-beads/pi-web": patch
---

A reply that failed while pi was about to retry it now shows when no retry replaced it, with a line after it saying why: "Retry cancelled" when you press Stop during the wait, the compaction's error when pi could not make room to retry, or that the run ended, the session closed, or the session was opened again first. Before, it stayed hidden, and a turn could end with nothing to show for it. A failure that a retry did replace stays hidden, and when every retry fails only the last failure shows. A reply pi takes back to compact the conversation and try again is now hidden while you watch, as it already was after a reload. Restart the session daemon and reload open pages.
