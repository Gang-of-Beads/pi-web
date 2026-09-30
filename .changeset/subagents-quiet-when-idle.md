---
"@gang-of-beads/pi-web": patch
---

The subagents panel no longer asks for its list every 3 seconds while nothing is running or nobody is looking. It reads the list while the session works and the panel or its tab is on screen, once when work starts or ends, and once when you come back to it. With a workspace panel open and the session idle, PI WEB used to make 40–47 requests a minute; with the files panel open it now makes none, and with the git panel open 14–16. An open workspace panel now also refreshes when the last background run of the session ends, not only when its turn does. Plugins hear this through `session-activity-settled`, and can read the session's `status` (`isStreaming`, `backgroundRunCount`) from the host state.
