---
"@gang-of-beads/pi-web": patch
---

The Gang of Beads preset installs background tasks as one package: `@gang-of-beads/pi-web-background-runs` 0.2.0 loads `pi-background-tasks` itself, so the installers no longer add it separately. An existing installation should remove the separate copy with `pi remove npm:pi-background-tasks`.
