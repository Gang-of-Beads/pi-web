---
"@gang-of-beads/pi-web": patch
---

Typing `/login` or `/logout` (with or without a provider id) in the composer opens the sign-in dialog again, whether the agent is idle or working. It was sent to the session instead and refused as "not implemented in the web UI yet".
