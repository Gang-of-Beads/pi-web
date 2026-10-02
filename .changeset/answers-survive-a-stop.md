---
"@gang-of-beads/pi-web": patch
---

Stopping a reply while an answer to a question card is still waiting no longer drops a message you send in that moment, and shutting the session daemon down no longer loses a waiting answer: it is written into the conversation, as on Stop and close.

Restart the session daemon to pick this up.
