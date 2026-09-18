---
"@gang-of-beads/pi-web": patch
---

Navigation drops the folder level.

A project and a folder read as the same thing - a project with no worktrees
prints its name on both levels - so the level cost a tap and taught nothing.
Navigation is machine, project, session; a project lists the sessions from all
of its folders, and which folder a session runs in stays a property of that
session rather than a place to stand.
