---
"@gang-of-beads/pi-web": patch
---

Server plugins can say where their extension does background work: `agentFacts.workPaths` lists the directories the session daemon watches to recount a session's background runs, and the Files and Git panels ignore the ones under the session's working directory. The Subagents plugin now declares its own; turning it off stops watching its directories. Restart the session daemon to pick it up.
