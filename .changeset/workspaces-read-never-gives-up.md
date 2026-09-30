---
"@gang-of-beads/pi-web": patch
---

Opening a project no longer ends at "No workspaces found" when a workspaces read gets no answer. PI WEB tries again by itself and opens the project's workspace once the machine answers. It also no longer shows an error for the lost read, or "Loading workspaces…" and "No workspaces here yet" before the machine has answered. A session opened from another project now moves to its own project and workspace even when the first lookup got no answer.
