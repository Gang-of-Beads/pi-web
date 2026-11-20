---
"@gang-of-beads/pi-web": patch
---

The plugin-API declaration baseline now compares every emitted file, where three of twelve were held before, so a change to the other nine no longer passes unseen. The two unreachable `plugin-api.d.ts` / `server-plugin-api.d.ts` shims are gone from the repository and the tarball, `alpha` follows each plugin-API publication instead of naming an old build, and the plugin-API package's own `build` script runs the root command instead of repeating it.
