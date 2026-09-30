---
"@gang-of-beads/pi-web": patch
---

Opening a session no longer jumps. Tapping a session keeps you where you are while it loads, and the tapped row shows at once that it is opening, with a line running along the top edge. After a second it says "Opening…", and if the session cannot be read it says so and you stay. The list, the header and the conversation then switch together, and a session opened before switches at once. If you go somewhere else while a session is still loading, it no longer takes the page when it arrives. The same holds for restoring a page after a reconnect and for terminal runs that open their terminal.
