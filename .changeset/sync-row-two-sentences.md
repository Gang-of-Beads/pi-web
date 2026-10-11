---
"@gang-of-beads/pi-web": patch
---

The top row now says one thing per state while the link is down. It says "Trying to reach <machine>…" when the page cannot reach the machine that serves it, and "Trying to sync with <machine>…" when it reaches it but the machine on screen does not answer. A machine is always named, and nothing says "the server". The row also goes away as soon as anything arrives from the machine again, instead of saying "Trying to sync" while messages are already coming in. Reload the page to pick this up.
