---
"@vincenthanxiaodu/pi-web": patch
---

Stop telling the user an archived child has lost its parent

Archiving a subagent on its own moved its row into the archived section, which
is built as a separate tree. The parent was not in that tree, so the row was
marked an orphan and read "Parent session is not available in this workspace" -
while the parent sat unarchived one row above.

Whether a parent exists is now answered against every session in the workspace
rather than against whichever section the row landed in. A child whose parent
really is absent is still marked.
