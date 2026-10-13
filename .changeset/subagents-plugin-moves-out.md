---
"@gang-of-beads/pi-web": patch
---

The Subagents plugin no longer ships with PI WEB. It now lives in its own repository; to keep the Subagents tab and the supervisor-request card for pi-subagents, install it with `pi install npm:@gang-of-beads/pi-web-subagents`, then restart the session daemon and reload the page. Its plugin id stays `subagents`, so an existing `plugins.subagents` setting keeps applying.
