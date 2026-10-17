---
"@gang-of-beads/pi-web": patch
---

Taking a message back while its new session is still starting now takes it back from that session, instead of leaving the take-back where the session no longer looks. When a new session's start failed and sending a message starts it after all, the draft and attachments typed into it move to the started session with its messages.
