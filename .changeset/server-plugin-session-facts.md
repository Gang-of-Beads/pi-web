---
"@gang-of-beads/pi-web": patch
---

Server plugins can listen for facts about this machine's sessions through `context.events.on(kind, listener)`: a session created (started, `/new`, fork or clone), archived, restored or deleted, a run started and ended (completed, stopped by you, interrupted or failed), and a message accepted or withdrawn. Each fact names its session, working directory and, when known, its project and workspace. Plugins in the session daemon hear the facts directly; plugins in the web server hear them relayed from the daemon and are told `facts.resumed` when the relay comes back after a gap, such as a session-daemon restart. A run still open when the session daemon shuts down ends `interrupted`. Facts are announcements, never hooks, may repeat, and are not replayed. See [Server facts](docs/plugin-api.md#server-facts).
