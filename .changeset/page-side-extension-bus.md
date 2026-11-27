---
"@gang-of-beads/pi-web": patch
---

A PI WEB plugin page can read what the Pi extensions of the session on screen publish, and ask them, through `context.session.bus`: retained states, events and request/response over the channels the extension's package declares under `piWeb.bus`. See "Reading the session's extensions" in the plugin API reference. The session daemon needs a restart.
