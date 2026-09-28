---
"@gang-of-beads/pi-web": patch
---

Messages reach the agent in the order you sent them. While the agent works, every message waits in the session's queue, visible and recallable, and all of them are handed to the agent together at its next pause. A message that arrives while an earlier one is still being handed no longer overtakes it or gets refused. A retry of a message you recalled or stopped does not run it again. Waiting messages survive a daemon restart and are sent without anyone opening the session, and a read-only workspace no longer blocks sending.
