---
"@gang-of-beads/pi-web": patch
---

A message is marked delivered on evidence, and a command reports what it did

A sent message was promoted to delivered whenever the current queue snapshot
omitted it. A snapshot omits a message for several ordinary reasons - while the
agent expands a prompt, between taking it and writing it, and whenever its id
could not be stamped on at all - so one message could appear twice, as two cards
in different states, or vanish. Delivery is now proved by the agent's committed
copy, and pending rows are keyed so they cannot collide with history and make
the transcript jump.

Command receipts were settled by whether the request threw, so a refusal the
server returned successfully still showed a green "done" beside the server's own
"not implemented" line. A receipt now reports the outcome, and a command whose
answer is a dialog leaves no receipt behind rather than one stuck pending
forever.
