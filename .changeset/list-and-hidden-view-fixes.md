---
"@gang-of-beads/pi-web": patch
---

Fixes from a review of the session lists and the chat view. A session shown under "Project removed" opens on a tap again and keeps its usual menu, and a session that is still running stays reachable when its folder is deleted, so it can be read and stopped. On Windows, a folder's subfolder sessions are listed again and a project path with a trailing separator still claims its sessions. Switching to another view and back keeps the transcript in place however long you stay away, no longer puts one session's position into the next one you open, and resumes loading history that arrived meanwhile. A field in a tall dialog card stays in view while the keyboard opens.
