---
"@gang-of-beads/pi-web": patch
---

`/new` starts a new session from the web UI, at once, as in the terminal, even while the agent is working. Unless an extension cancels it, the reply in progress stops as it would on Stop and stays in the old session, and everything queued goes back to the composer of the browser that sent `/new`. Every browser showing the session then moves to the new one with its draft, and the returned messages move with it. `/new` with words after it is sent to the model as an ordinary message, as in the terminal. If an extension cancels `/new` or the new session cannot be created, the `/new` row says it failed and why; a cancelled `/new` stops nothing.

A fork or clone that fails after the old session was already closed for it no longer leaves that session silently dropping the next message: it opens again from its file. While a fork, clone or `/new` switches the session, a message or a read for the old session no longer reaches the new one. A queued command (a skill, an extension command) shows once on the device that sent it, as its command row.
