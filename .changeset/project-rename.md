---
"@gang-of-beads/pi-web": patch
---

Rename a project from its **⋯** menu: a project's name is its folder's name, so **Rename** renames the folder. Its sessions, archived sessions, unread marks, saved trust decisions and any project inside it follow, and the links between Git repositories and their worktrees are repaired where the move broke them, for every repository inside the folder, a project or not. The dialog lists what has to stop first (a working session, an open terminal) and refuses a name already taken, or a change of letter case alone on a disk that ignores case while workspaces are inside the folder; a rename that fails partway puts everything back, the folder's name included. Plugin authors: a workspace provider may implement `relocate` to repair its own links after a rename. Restart the session daemon after updating; a machine whose daemon was not restarted shows **Rename** disabled and says why.
