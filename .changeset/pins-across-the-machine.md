---
"@gang-of-beads/pi-web": patch
---

Pinned answers for the machine, not the current project.

Pinning from the global list worked but the Pinned group did not appear: the
pinned set was read from the project-scoped session list, so a pin on anything
outside that project had nothing to render. It reads the machine-wide list too.
