---
"@jmfederico/pi-web": patch
---

Show cross-workspace session relationships in the session list. A session whose parent lives in another worktree now names that parent's workspace or branch instead of only reporting an unavailable parent, and offers a "Go to parent session" action that switches to the owning workspace and selects the parent. A session with children in other workspaces of the same project now shows how many, so a parent no longer looks childless when its children are not nested beneath it.
