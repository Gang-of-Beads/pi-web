---
"@gang-of-beads/pi-web": patch
---

Fixes in this release's new terminal keys and pages. An armed CTRL or ALT is cleared when you switch to another terminal or hide the key row, so it can no longer act on a different shell; holding an arrow no longer cancels a CTRL you just armed; and CTRL now works with symbols and digits the way a terminal does (CTRL then | sends Ctrl+|, CTRL then / sends Ctrl+/). The Updates page shows the machine's status messages that its rows do not already say, so its badge never counts something the page does not show. Times from another day read with their date ("Oct 6, 14:32"). The "Trying to sync with the server…" row no longer stays up while the server is answering again. Reload the page; restart the web server and the session daemon for the Docker update command change.
