---
"@gang-of-beads/pi-web": patch
---

Pins no longer cost a request every few seconds while you read. The page read a machine's pins again on any redraw once its last answer was two seconds old, which with the git panel open meant seven or eight requests a minute with nothing happening. It now reads them once, and again when the machine says they changed (a pin or unpin made on another device of the machine that serves the page shows at once), when its connection comes back, or when you return to the tab. The session daemon and the web server both need a restart for this to take effect.
