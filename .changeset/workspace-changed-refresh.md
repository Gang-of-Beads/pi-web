---
"@gang-of-beads/pi-web": patch
---

Workspace panels refresh when files change on disk.

The files and git panels refreshed only on demand: an agent editing a file
next to the reader left the panel stale until a tap. The session daemon now
watches the working directory of every session it holds open and publishes
one `workspace.changed` per burst; the browser refreshes the panels of the
workspace it shows when the directory and machine match, and ignores every
other machine's or directory's news. Manual refresh stays; a directory that
cannot be watched is simply as fresh as before.
