---
"@gang-of-beads/pi-web": patch
---

A plugin whose helper imports a package still loads.

The plugin build decided whether to bundle by reading the entry file alone, so
a plugin whose entry imported only its own modules shipped unbundled even when
one of those modules imported lit - the browser then refused the whole plugin.
The decision now walks the entry's import graph.
