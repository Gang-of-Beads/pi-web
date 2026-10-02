---
"@gang-of-beads/pi-web": patch
---

An answer to a question card no longer disappears while the agent is busy. It now shows in the conversation as your answers, marked Queued, from the moment you send it, and the agent reads it as soon as it finishes its current step instead of after all its remaining work (the audit saw an answer go unseen for 23 seconds, and answers have waited up to 26 minutes). Notices that a sub-session finished travel the same way. Stopping a reply, or closing the session, no longer loses an answer still waiting: it is written into the conversation without starting a new reply.

Restart the session daemon to pick this up.
