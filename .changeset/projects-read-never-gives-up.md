---
"@gang-of-beads/pi-web": patch
---

The project list no longer gets stuck on "Couldn't read the projects on this machine." When a read gets no answer, PI WEB tries again by itself and keeps the projects it already knows on screen. If the machine you're using stays unreachable for a few seconds, the app's status row says "Reconnecting…" until it answers. Pages no longer show "Loading projects…" or claim there are no projects before the machine has answered.
