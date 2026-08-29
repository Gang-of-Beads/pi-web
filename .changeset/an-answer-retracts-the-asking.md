---
"@vincenthanxiaodu/pi-web": patch
---

Answering a question or dialog now retracts the amber "asking" marker everywhere it is read, not just on the card in front of you: the session's row and the quick switcher stop asking once the daemon says it was answered, the answer still lands when you navigate away while it is being submitted, and indicators a reconnect's status catalog no longer stands behind are dropped instead of held until a reload. Opening the quick switcher also reconciles the indicators against the daemon's catalog, so a dropped frame can no longer leave a finished session marked as waiting.
