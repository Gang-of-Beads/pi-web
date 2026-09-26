---
"@gang-of-beads/pi-web": patch
---

The title in the header opens the scope picker, as its own label promised.

The context sheet - projects and workspaces with the current one marked - had no
opener at all: openContextSheet() was called by nothing, so the sheet rendered
only in tests. The header title has said "Open session selection" in its
aria-label all along, so its plain click opens the sheet now, and the quick
switcher keeps Cmd+K on a desktop and the board search on a phone.
