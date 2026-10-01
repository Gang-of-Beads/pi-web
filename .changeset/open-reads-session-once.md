---
"@gang-of-beads/pi-web": patch
---

Opening a session no longer reads it several times over. A session whose extensions raise a dialog as it starts used to be read five times, and its live stream fetched again five times, in its first seconds: the dialog reached the page before the page's first read answered and made it read again, and dialog frames lost their position in the stream, so the next update looked like a missed one. An open now reads the session once and the dialogs still show.
