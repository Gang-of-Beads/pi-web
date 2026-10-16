---
"@gang-of-beads/pi-web": patch
---

Prevent streamed Markdown from temporarily adding an extra line or paragraph gap before formatting catches up. Keep safe text appends inside their actual block and reuse unchanged Markdown DOM during canonical updates. Preserve code-copy content and reject stale asynchronous code-fence drawings.
