---
"@gang-of-beads/pi-web": patch
---

Drawer tabs now honor the availability contract they document: a section
answering `false` loses its tab instead of keeping a dead one, and the drawer
disappears entirely when every contributed section is unavailable - so the
goals section on a workspace without goal records no longer shows a "Goals"
tab wrapping an empty body. The goals section's unread window says "Reading
goal records…" in the section's muted micro style instead of rendering a bare
"No goal records found." paragraph once the empty read lands.
