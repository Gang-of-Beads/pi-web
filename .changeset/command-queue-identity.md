---
"@gang-of-beads/pi-web": patch
---

Run each separately sent extension command, skill or prompt template while the agent is busy, even when its text matches one already waiting; a resend of the same command still runs it once. An extension command sent first in a new session no longer names the session or sends its arguments to the title model.
