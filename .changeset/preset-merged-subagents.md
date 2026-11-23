---
"@gang-of-beads/pi-web": patch
---

The Gang of Beads preset installs `@gang-of-beads/pi-subagents` alone for subagents. Its PI WEB half moved into that package, so `@gang-of-beads/pi-web-subagents` is deprecated and no longer part of the preset; installing both loads the same extension twice.
