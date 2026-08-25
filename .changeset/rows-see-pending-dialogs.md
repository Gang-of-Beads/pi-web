---
"@vincenthanxiaodu/pi-web": patch
---

Let session rows see a pending dialog too. The shared classifier every row and the quick switcher read counted only an `ask_user` question set, so a session blocked on an extension dialog was listed as idle. The rule now lives in one place, next to the rest of the session-state classification.
