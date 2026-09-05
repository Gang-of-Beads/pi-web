---
"@gang-of-beads/pi-web": patch
---

The goals plugin no longer ships inside PI WEB: it lives in its own repository and installs as the `@gang-of-beads/pi-web-goals` package (npm or git), the same move the theme pack made. The drawer and navigation panel keep rendering any goals section a plugin contributes; a checkout that wants goals installs the package into the agent directory.
