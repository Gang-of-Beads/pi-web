---
"@gang-of-beads/pi-web": patch
---

Speed up session-board refreshes on machines with many workspaces and stored sessions by sharing only in-flight store scans and checking folder presence once per matching folder, while keeping each workspace's own session-directory snapshot current. Restart the session daemon after updating to apply this fix.
