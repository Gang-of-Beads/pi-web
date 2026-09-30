---
"@gang-of-beads/pi-web": patch
---

PI WEB now tells a session that is really gone apart from a read that failed for another reason. Before, if reading a session's messages or status failed for any reason, the session was reported as not found. That included a session folder the daemon couldn't read, where PI WEB could even replace a new session that still existed. Now only a session that doesn't exist is reported as not found. Any other failure is reported as an error with its own reason. The session daemon needs a restart for this to take effect. Machines still running an older daemon keep working.
