---
"@gang-of-beads/pi-web": patch
---

PI WEB now serves the browser files of plugins that run in its web server without waiting for the session daemon. While the daemon was busy, each of those files could take a third of a second; they now take about a millisecond.
