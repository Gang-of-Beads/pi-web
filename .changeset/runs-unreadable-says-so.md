---
"@gang-of-beads/pi-web": patch
---

When a session's subagent run folder cannot be read (for example, permission denied), the Subagents panel now says it could not read the runs, and the session keeps its last background-run count, instead of showing "no runs" and 0 running. Restart the session daemon to pick it up.
