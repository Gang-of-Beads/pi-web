---
"@gang-of-beads/pi-web": patch
---

The Goals plugin no longer ships with PI WEB. It now lives in its own repository; to keep the Goals tab and the goal event rows for pi-goal, install it with `pi install npm:@gang-of-beads/pi-web-goals`, then restart the session daemon and reload the page. Its plugin id stays `goals`, so an existing `plugins.goals` setting keeps applying.
