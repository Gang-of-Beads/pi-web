---
"@gang-of-beads/pi-web": patch
---

The git panel can add a worktree.

A "New worktree" button beside the branch name opens a dialog for the
branch (new or existing) and the directory, suggested beside the repository
as <repo>-<branch>. The plugin runs git worktree add through its own
provider seam, keeps git's refusal in the dialog for correction, and the
new checkout appears in the workspace list and the git panel without the
app switching to it. Workspace panels gain host.refreshAppData for exactly
this: report a catalog change, never edit the catalog.
