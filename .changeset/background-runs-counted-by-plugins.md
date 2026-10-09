---
"@gang-of-beads/pi-web": patch
---

A session's "N background runs" now counts subagent runs through the Subagents plugin, so turning that plugin off stops them counting at once, and turning it back on counts them again without waiting for anything to change on disk. Server plugins can add their own runs to the count with the new `backgroundWork` activation hook. Restart the session daemon to pick it up.
