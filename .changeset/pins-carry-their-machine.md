---
"@gang-of-beads/pi-web": patch
---

Pinned sessions belong to the machine they were pinned on.

Pins were stored as one flat list of session ids with no machine key, so a
recycled id from another machine could arrive already pinned, and the list
grew without bound. The store is keyed by machine now, the visible set is
re-read whenever the selected machine changes, and an existing flat list is
read as the local machine's pins and preserved on the next write.
