---
"@gang-of-beads/pi-web": patch
---

PI WEB no longer floods the machine with Git and file refreshes while an agent works. The session daemon now only reports real changes in a workspace: edits to your files, and commits, checkouts and staging. It ignores Git's internal files, `node_modules` and pi's own logs. Git changes show within a quarter second, and file edits are grouped into one update every few seconds. A hidden browser tab now waits and refreshes once when you come back. The session daemon needs a restart to pick this up.
