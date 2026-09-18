---
"@gang-of-beads/pi-web": patch
---

List rows say one thing, and the menu beside them does the rest.

Every navigation row is now a name on the left and a ⋯ menu on the right: the
second line of path is gone from project rows (it stays in the tooltip), and
the menu carries what you can do to that row - open, pin, rename, copy path,
close project - acting on the row it belongs to rather than the current
selection. Session rows carry their state again as a mark beside the name:
waiting, working, or idle. Asking for Machines while standing in a project
answered "Nothing to choose at this level" with machines sitting right there;
every level offers its own choices now.
