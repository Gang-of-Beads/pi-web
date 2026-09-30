---
"@gang-of-beads/pi-web": patch
---

When a read of the machine list gets no answer, PI WEB now tries again by itself and shows no "Lost connection" banner. Before, a local page could be left without its machine list until you reloaded. A link to a remote machine now waits for the machine list, keeping the link intact, and opens as soon as the list answers. It no longer gives up with "is still unavailable." after five tries: it keeps trying every few seconds, up to every 15 seconds, for as long as you stay on that link.
