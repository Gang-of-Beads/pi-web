---
"@gang-of-beads/pi-web": patch
---

A very long session no longer slows down the whole machine while it runs. Every status the session daemon sent re-counted the session's messages and context usage over its entire history; on a session with about 93,000 messages that took about 100 ms each time, and a reply sends many statuses, so the daemon spent most of every reply recounting and every other session and browser waited behind it. These figures are now counted once each time the conversation changes. Restart the session daemon to pick it up.
