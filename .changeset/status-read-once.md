---
"@gang-of-beads/pi-web": patch
---

The page and the updates plugin share one read of PI WEB's status at load instead of asking the machine twice. Plugins can ask for the status of their own machine through `readPiWebStatus` in their activation context. A browser reload is enough.
