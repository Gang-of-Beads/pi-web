---
"@gang-of-beads/pi-web": patch
---

Plugins can tell an absent workspace file from a failed read without comparing error text: a refused workspace file call carries a code (`path-missing` or `path-not-a-directory`), and the plugin API exports `workspaceFileRefusalOf(error)` to read it. The bundled Tasks and Relays pages use it. Restart the web service.
