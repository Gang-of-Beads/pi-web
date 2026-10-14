---
"@gang-of-beads/pi-web": patch
---

Messages to a session started in a subfolder of the open project are delivered again. Opening such a session from the parent project sent the project's folder instead of the session's own, so every message came back "Not sent: Session not found" until the page was reloaded.
