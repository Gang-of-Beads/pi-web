---
"@gang-of-beads/pi-web": patch
---

The quick-access menu shows a context path instead of mixed chips.

Machines were a tab strip and projects were chips, and choosing a project made
a folder chip appear beside the project chips with nothing saying which kind
each one was — tapping "repo" produced a "main" that could have been anything.
The menu now shows one path, Machine › Project › Folder, where each level says
what is chosen there and opens only its own options. The third level is named
for what it is, a folder on disk; whether that folder is a git worktree is the
git plugin's business, not the shell's.
