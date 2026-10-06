---
"@gang-of-beads/pi-web": patch
---

The message box's editor now loads with the page. It used to be fetched separately when a session opened, and if that one download failed (for example while the server was restarting) the tab showed no message box at all until it was reloaded. Reload the page to pick it up.
