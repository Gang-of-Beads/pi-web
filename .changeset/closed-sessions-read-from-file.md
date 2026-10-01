---
"@gang-of-beads/pi-web": patch
---

Opening an archived session no longer starts it: its transcript and background tasks are read from its file, so it shows at once, without "Opening session: Loading session extensions" or loading every extension for a session that takes no messages. A closed session's background tasks and earlier pages are read the same way. The session daemon needs a restart for this to take effect.
