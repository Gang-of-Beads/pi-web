---
"@gang-of-beads/pi-web": patch
---

The Workflows plugin no longer ships with PI WEB. It now lives in its own repository; to keep the pi-dynamic-workflows progress card, install it with `pi install npm:@gang-of-beads/pi-web-workflows` and reload the page. Its plugin id stays `workflows`, so an existing `plugins.workflows` setting keeps applying.
