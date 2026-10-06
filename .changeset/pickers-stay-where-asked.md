---
"@gang-of-beads/pi-web": patch
---

The model and thinking-level pickers no longer pop up by themselves. They read the session's options before opening, and if you moved on in the meantime (another page, another session, another picker) they used to open anyway, over whatever came next; now they stay closed. Reload the browser.
