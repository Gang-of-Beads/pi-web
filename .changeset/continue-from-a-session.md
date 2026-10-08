---
"@gang-of-beads/pi-web": patch
---

A new session can now start from an existing one. On the Navigate page's Sessions list, "↻ Continue from…" sits beside "+ New session": tap it, then tap the session to continue, and a new session opens that carries that session's whole conversation, while the original stays as it was. A session that is still working is refused with a message saying so; stop it first. Restart the web service and the session daemon to pick it up.
