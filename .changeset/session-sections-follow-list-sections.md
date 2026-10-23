---
"@gang-of-beads/pi-web": patch
---

Browser plugins' session sections (`sessionSections`) now follow the same rules as `listSections` on the sessions list: one ordering and scope, and a claim that throws is left out and logged once. The plugin API reference maps which entry points draw on which list, and says why workspace labels stay the way to label the workspace list.
