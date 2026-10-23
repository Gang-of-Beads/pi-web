---
"@gang-of-beads/pi-web": patch
---

Browser plugins can label the rows of the workspace list with `listLabels` (`list: "workspaces"`). Session sections and workspace labels keep working and now follow the same rules as the list entry points: a failing claim or label is left out and logged once, and session sections are ordered and scoped like `listSections`.
