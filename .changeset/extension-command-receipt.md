---
"@gang-of-beads/pi-web": patch
---

An extension command typed while the agent works no longer reads "Queued · Runs after the current reply finishes": it runs at once, as in pi's terminal, and its row reads Running until the command's handler returns. If the session refuses the command before it runs, the row says it failed and why. A plugin page that ran a command hears what the handler said.
