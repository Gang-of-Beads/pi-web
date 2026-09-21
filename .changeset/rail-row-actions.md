---
"@gang-of-beads/pi-web": patch
---

Row actions work on the desktop rail.

Pin, rename and open looked the row up only among the selected workspace's
sessions, so on the rail - whose rows come from the machine listing - every
menu action returned silently. The rail also requests that listing now,
instead of reading "No sessions in this part of the path" on a machine full
of them.
