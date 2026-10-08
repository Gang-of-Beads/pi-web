---
"@gang-of-beads/pi-web": patch
---

A new session can now start from an existing one. On the Navigate page's Sessions list, tap "+ New session", choose "Continue from…", then tap the session to continue (the button reads "✕ Continue from…" until you do; tap it to cancel), and a new session opens that carries that session's whole conversation, while the original stays as it was. A session that is still working is refused with a message saying so; stop it first. Restart the web service and the session daemon to pick it up.
