---
"@gang-of-beads/pi-web": patch
---

The session list on the navigation page and in session search no longer says "No sessions yet." while the machine hasn't answered. It also no longer shows "Loading sessions…" or a failure. It keeps reading by itself and lists the sessions once the machine answers. When one workspace doesn't answer, the other workspaces' sessions still show, and the missing ones appear once it answers. Before, that workspace was quietly left out.
