---
"@gang-of-beads/pi-web": patch
---

The folder level appears only when there is a folder to choose.

A project whose only folder is its own checkout printed the same name on two
levels, which read as a duplicate rather than as a hierarchy. The folder level
now appears when a project has more than one folder, which is when git
worktrees exist; the path still names the folder a session runs in.
