---
"@gang-of-beads/pi-web": patch
---

The Gang of Beads preset no longer installs `@gang-of-beads/pi-web-goals`: it was written for the earlier pi-goal and reads goal files pi-goal 1.0.0 no longer writes, and PI WEB's bundled Goal plugin now draws pi-goal's pages. Remove it from an existing install with `pi remove npm:@gang-of-beads/pi-web-goals`, then restart the session daemon.
