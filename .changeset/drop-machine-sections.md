---
"@gang-of-beads/pi-web": patch
---

The plugin API no longer has `machineSections`: no part of PI WEB ever drew a contributed machines section, so a plugin that declared one showed nothing. The Navigate page lists the machines itself. Restart the web service to pick it up.
