---
"@gang-of-beads/pi-web": patch
---

Answer a message sent right after Stop. While the stopped reply or tool call is still ending, a new message now waits in the queue and starts its own turn once the stop has finished, instead of being handed to the turn being stopped, where it could get no answer. The status line says "1 message starts a new turn after the stop" meanwhile. An extension command sent then still runs at once. Messages that were already waiting when Stop was pressed still come back to the composer. Restart the session daemon to apply.
