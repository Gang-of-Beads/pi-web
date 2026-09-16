---
"@gang-of-beads/pi-web": patch
---

The host actually hands plugins the sheet-adoption mechanism.

The PluginHostUi gained adoptSheets as a type but the runtime object never
implemented it, so every plugin wrapper that routed adoption through the
host (workspaces, goals, terminal) silently stopped adopting: the context
sheet rendered unstyled headings, edge-to-edge rows, and stray buttons.
The member is now on the object the shell hands to plugins.
