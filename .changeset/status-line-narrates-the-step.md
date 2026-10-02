---
"@gang-of-beads/pi-web": patch
---

The status line under a conversation now says what the agent is doing right now and for how long: "Thinking · 4 s", "Running bash: sleep 25 · 12 s", "Retrying, attempt 2 of 3: overloaded". When you have sent messages or an answer while it works, it says when they are read ("1 message is read when these tools finish") instead of a stale "message queued". A session no longer flickers to idle between steps of one reply; it goes idle once, when the reply ends.

Restart the session daemon to pick this up.
