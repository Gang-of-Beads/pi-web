---
"@gang-of-beads/pi-web": patch
---

An extension command typed while the agent works no longer reads "Queued · Runs after the current reply finishes": it runs at once, as in pi's terminal, and its row reads Running until the command's handler returns. A plugin page that ran a command hears what the handler said.
