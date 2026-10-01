---
"@gang-of-beads/pi-web": patch
---

Sending a message, shell line or command to a session that was deleted elsewhere in the meantime (on another device, with the pi command line, or by removing its file) now says "This session no longer exists, so your message was not sent." at the top and in the transcript, instead of "Session not found". A message's words stay in the composer. Reload the page to pick this up.
