---
"@gang-of-beads/pi-web": patch
---

A failed send stays in the session it was sent from.

The resend/discard row could appear in a session the message was never sent from: the send
captured the right key, then wrote its answer into whatever the editor was showing. A
pending message now carries its own state and its own scope, the row is a selection over
the records whose scope matches the session on screen, and a transition table (stored to
sending to accepted to delivered, with failed and unverified alongside) decides every move
so an unhandled event fails in tests rather than in a renderer. The composer restore waits
until the reader is back in that session; a live answer for another one cannot rewrite it.
