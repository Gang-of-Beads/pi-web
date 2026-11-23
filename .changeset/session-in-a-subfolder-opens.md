---
"@gang-of-beads/pi-web": patch
---

A session recorded in a folder inside the one you are looking at opens from the list that shows it. A project's list covers its whole directory tree, so such a row was listed under the folder above it, but opening it looked for the session only in that folder's own directory and answered "Session not found". A session recorded in the folder itself still wins over one in a subfolder of it.
