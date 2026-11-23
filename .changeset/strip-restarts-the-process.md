---
"@gang-of-beads/pi-web": patch
---

The version strip restarts the process it names by itself. Reload cannot finish an installed update whose web server is already current: the page stays, the stale session daemon stays, and the strip comes back. Where no plugin contributes the restart action - and on a page reaching this server from another machine - the strip now restarts just that process (`POST api/pi-web/restart` takes `web`, `sessiond` or all).
