---
"@gang-of-beads/pi-web": patch
---

Opening a terminal in a workspace whose folder is gone fails fast with one
sentence.

The daemon validated the session start path but not the terminal spawn: a
pty spawned in a missing directory started a shell that chdir-failed and
exited code 1 instantly, leaving a dead "Shell · exited" tab and no
explanation. The terminal create now stats the workspace folder first and
answers "Workspace folder does not exist: <path>" before any process is
spawned.
