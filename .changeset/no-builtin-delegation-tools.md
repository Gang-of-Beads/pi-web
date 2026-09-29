---
"@gang-of-beads/pi-web": patch
---

PI WEB no longer gives agents its own tools for starting sessions. `spawn_session`, `spawn_subsession`, `list_subsessions`, `check_subsession`, `read_subsession` and `yield_to_subsessions` are gone, so an agent no longer fills your session list with sessions it started unasked. Starting sessions is now a session-daemon interface instead: routes to start an independent session, start a tracked child, and check or read a child. A plugin or extension of your own can offer tools built on them. The `spawnSessions` and `subsessions` settings are retired and ignored. Restart the session daemon to pick this up.
