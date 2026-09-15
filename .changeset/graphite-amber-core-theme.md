---
"@gang-of-beads/pi-web": patch
---

The default theme is graphite and amber, with a native light side.

The stock blue-on-black reads like a default; the owner picked graphite
with a single amber accent. The core theme now ships both sides of that
hue - the dark palette and a warm-paper light one under the system
prefers-color-scheme media query, so it follows the device without a
plugin, and Appearance keeps overriding with any theme pack as before.
