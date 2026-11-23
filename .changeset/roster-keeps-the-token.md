---
"@gang-of-beads/pi-web": patch
---

A machine's access token now survives the page reading its roster: the list parser dropped the field, so every request the page sent the machine itself still went out unnamed and was refused, however the token was stored.
