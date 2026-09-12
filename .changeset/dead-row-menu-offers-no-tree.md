---
"@gang-of-beads/pi-web": patch
---

A dead session's menu no longer offers History and branches.

Browsing the tree runs /tree against the selected session, and a dead
session can never be selected - offering the entry traded the inert row
for the red banner again through the row's own menu. The menu on a dead
row keeps only actions that never select: mark read, archive, rename,
detach, stop. Delivering this also confirmed the phone cache story:
index.html is no-store, so a pull-to-refresh always picks up the current
build.
