---
"@gang-of-beads/pi-web": patch
---

A reconnect asks rather than resends. Messages whose answer the link lost stay
open on their own row; when the socket comes back the browser hands the daemon
the identities it is still holding and takes the answer, so a message that was
accepted settles and one the daemon has no row for stays honestly unknown
instead of being resent blind or being reported as gone. Identities the daemon
did not answer for are absent from the reply, and the client keeps them open —
"we have no row" and "it did not happen" are different facts, and only the
second would justify telling the reader the message failed.
