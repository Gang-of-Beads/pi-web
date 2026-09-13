---
"@gang-of-beads/pi-web": patch
---

Transient refresh failures retry themselves instead of sitting as a
dead banner.

A 5xx on the workspace sessions refresh painted "The request failed
(502)" and left it there until the next unrelated trigger - the reader
stuck with an error that explained nothing and fixed nothing. The
refresh now retries itself with backoff (up to four attempts), the
banner reads "… — retrying…" while it does, a success clears it, and
permanent 4xx errors keep their message without a loop.
