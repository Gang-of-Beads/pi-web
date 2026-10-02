---
"@gang-of-beads/pi-web": patch
---

A dialog an extension command opens no longer closes by itself when an unrelated reply finishes. Typing a command such as `/goal-clear` while the agent was working opened its question, then closed it within a second when that reply ended, so the command went ahead as if you had cancelled. A command's dialog now stays open until you answer or cancel it; dialogs the reply itself opened still close when it ends or is stopped.

Restart the session daemon to pick this up.
