---
"@gang-of-beads/pi-web": patch
---

The navigation page lists one kind of thing at a time.

Sessions, folders and projects were stacked on one page, so a folder read as a
session; the path also scrolled sideways, which is unusable with a thumb. The
page now has a scope line that shares the width and ellipsises, a row of kinds
- Sessions, Machines, Projects, Folders - and a list showing exactly one of
them, with a colour and an icon per kind. Session rows say state, size and
folder instead of a row of hashes; tags stay searchable.
