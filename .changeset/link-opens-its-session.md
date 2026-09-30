---
"@gang-of-beads/pi-web": patch
---

A link to a session now always opens that session, or says why it can't. Before, a link to a session that had been deleted quietly opened a different session in the same workspace, while the address bar still showed the deleted one. Now PI WEB checks with the machine. If the session is gone, the page says so and offers a way back to that workspace's sessions. A session recorded in a subfolder of the workspace, or one not yet saved to disk, opens instead of being reported missing. While the machine hasn't answered, the page says the session is loading and keeps asking; it never declares a session gone without an answer. The session daemon needs a restart for this to take effect.
