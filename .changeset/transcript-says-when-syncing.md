---
"@gang-of-beads/pi-web": patch
---

A session no longer shows "idle" next to a conversation that is missing the reply. When the page may have missed something (it came back from the background, the network or the connection came back, a turn just ended), the status reads "Syncing…" while it fetches what it missed, then shows the real status; if it cannot reach the server it says "Offline · updated HH:MM" and keeps trying. A dropped last batch of messages is now noticed and fetched too. Reload the browser.
