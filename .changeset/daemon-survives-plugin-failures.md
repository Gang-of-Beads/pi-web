---
"@gang-of-beads/pi-web": patch
---

The session daemon survives plugin failures instead of dying with every active run. A pi-updater timer touching a disposed extension runner crashed the whole daemon mid-turn - two in-flight agent runs died with it, seen by the owner as agents stopping for no reason. Unhandled rejections and uncaught exceptions are now logged loudly and survived; the daemon is the long-lived owner of active runs and a plugin bug must never take it down.
