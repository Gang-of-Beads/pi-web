---
"@gang-of-beads/pi-web": patch
---

`/new` starts a new session from the web UI. It waits in the queue behind whatever is ahead of it, runs once the agent is idle, and every browser showing the session moves to the new one with its draft. Messages queued after `/new` are dropped, and the browser that sent them keeps them in the new session's prompt history. `/new` with words after it is sent to the model as an ordinary message, as in the terminal. If an extension cancels `/new` or the new session cannot be created, the `/new` row says it failed and why. A command queued behind `/new` says it did not run, and Stop removes the `/new` row along with handing it back to the composer.

A fork or clone that fails after the old session was already closed for it no longer leaves that session silently dropping the next message: it opens again from its file. While a fork, clone or `/new` switches the session, a message or a read for the old session no longer reaches the new one. A queued command (`/new`, a skill, an extension command) shows once on the device that sent it, as its command row.
