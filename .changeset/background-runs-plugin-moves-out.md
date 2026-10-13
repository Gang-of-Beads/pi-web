---
"@gang-of-beads/pi-web": patch
---

The Background runs plugin no longer ships with PI WEB. It now lives in its own repository; to keep the Background tab and the running count for pi-background-tasks, install it with `pi install npm:@gang-of-beads/pi-web-background-runs`, then restart the session daemon and reload the page. Its plugin id stays `background-runs`, so an existing `plugins.background-runs` setting keeps applying.
