---
"@gang-of-beads/pi-web": patch
---

Pinned projects now live on the machine, beside the pinned sessions, so every device browsing a machine shows the same pinned projects in the same order. A browser hands over the projects it had pinned the first time it opens a machine. Each browser now remembers that it already handed its old pins over, so a pin you remove on one device no longer comes back when another device reopens. A machine running an older PI WEB keeps pinned projects in each browser, as before. Restart the web service to pick this up.
