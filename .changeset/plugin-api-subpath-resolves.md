---
"@gang-of-beads/pi-web": patch
---

The plugin API subpath resolves at runtime, not only for types.

`@gang-of-beads/pi-web/plugin-api` exported types but no runtime entry, so a
plugin importing its one runtime value - the core status flags - failed to
resolve the specifier. The subpath now maps to the built module as well.
