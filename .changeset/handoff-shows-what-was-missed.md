---
"@gang-of-beads/pi-web": patch
---

Switching machines no longer loses a session rename or new session announced during the switch, a session being started keeps its "Creating session" mark while the page checks the machine's states, and a background tab no longer refreshes panels nobody is looking at after a reconnect. Reload the page to pick this up.
