---
"@gang-of-beads/pi-web": patch
---

A session being opened no longer reads as working. Its row in the session list and the quick switcher, and the chat's status line, show the spinner the tap already shows until the session's extensions have loaded, instead of the working dots, and it stays out of the working group. A reload or a fork, which start the session again, read the same way, and a duplicate send or a recall no longer flashes a session as working. Restart the session daemon and reload the page to apply.
