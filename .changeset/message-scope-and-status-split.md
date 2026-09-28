---
"@vincenthanxiao/pi-web": patch
---

A failed send stays in the session it was sent from, and a plugin's status says where it
belongs.

The resend/discard row could appear in a session the message was never sent from: the send
captured the right key, then wrote its answer into whatever the editor was showing. A
pending message now carries its own state and its own scope, the row is a selection over
the records whose scope matches the session on screen, and a transition table (stored to
sending to accepted to delivered, with failed and unverified alongside) decides every move
so an unhandled event fails in tests rather than in a renderer. The composer restore waits
until the reader is back in that session; a live answer for another one cannot rewrite it.

A plugin's status also declares where it belongs (`topEntry` on a panel or a drawer
section) and whether the thing it reports is running: subagents, background tasks and goals
ask for the strip above the transcript, git and files stay in the navigation menu, and only
a running chip pulses.
