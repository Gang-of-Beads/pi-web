---
"@gang-of-beads/pi-web": patch
---

A message whose send ended in a gateway or proxy error (a 5xx) now stays in the conversation marked unanswered, instead of disappearing and being handed back to the composer while the daemon may already be running it. A message the daemon has already confirmed stays even if a later answer disagrees, a timed-out send is marked in the session list like one that failed, and a message that left the queue of an idle session is no longer shown as read until the conversation actually contains it.
