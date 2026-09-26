---
"@gang-of-beads/pi-web": patch
---

An offline send keeps its row, and the row offers Retry.

The composer decides between accepted, refused and "the link dropped, keep the
outbox row" from what the send settles to - and the host fired the send without
returning its promise, so every failure looked accepted and the outbox entry was
forgotten. What the reader saw was a normal-looking bubble for a message the
daemon never got, with no Retry under it.

The other half was the new reconcile: it counted the optimistic bubble as proof
of delivery, and then counted the client own "unverifiable" marking from the
failed send too. Only a state the daemon produced counts now.
