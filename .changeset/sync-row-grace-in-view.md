---
"@gang-of-beads/pi-web": patch
---

The "Trying to reach…" and "Trying to sync with…" row now waits 10 seconds instead of 4, and counts only the time the page is on screen. Coming back to the browser after a while no longer shows it while the page reconnects: the reads and the reconnect a return sends get the full 10 seconds to answer, and a connection waiting to retry retries at once. Reload the page to apply.
