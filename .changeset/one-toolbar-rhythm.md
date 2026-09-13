---
"@gang-of-beads/pi-web": patch
---

One toolbar rhythm for the workspace panels.

The Files, Tasks and Relays panels each tuned their own toolbar
padding: Files on the shared 8px, Tasks and Relays on a wider 10/12px
override, so switching panels shifted the header rhythm. All three now
share the same token padding and the panel-header height, matching the
diagnosis item "six tool panels, three rhythms".
