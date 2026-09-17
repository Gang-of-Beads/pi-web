---
"@gang-of-beads/pi-web": patch
---

Opening a context-path level moves focus into it, and closing brings it back.

The options were reachable only by walking the DOM, and closing a level left
focus on the sheet rather than on the level that was just operated. Focus now
follows the level the reader opened and returns to it when the level closes.
