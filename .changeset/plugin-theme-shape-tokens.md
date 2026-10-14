---
"@gang-of-beads/pi-web": patch
---

A plugin theme can set the shape and typography tokens (`--pi-font-ui`, `--pi-font-display`, `--pi-font-mono`, `--pi-radius-xs` to `--pi-radius-xl`) without a type error: the public `ThemeTokens` in `@gang-of-beads/pi-web/plugin-api` now accepts them, as the host already applied them and its internal type already allowed them.
