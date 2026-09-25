---
"@gang-of-beads/pi-web": patch
---

A session reopens where the reader left it.

Only a position within two pixels of the bottom counted as the bottom; anything
further up saved an anchor, and an anchor that is not in the loaded window
sends the restore to the top of the transcript to page history in. So opening
a session could throw the reader far above and make them scroll all the way
back. Reading near the bottom now saves the bottom.
