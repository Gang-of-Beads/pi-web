---
"@gang-of-beads/pi-web": patch
---

Two delivery guarantees for bad networks, reviewed and hardened.

A retried message runs once. The browser resends from its outbox with the same
identity whenever a response was lost; the daemon now keeps a bounded ledger of
accepted identities and answers a repeat by repeating the acceptance instead of
running the prompt again. A deliberate resend carries a fresh identity and is
never swallowed, and a submission the runtime refused gives its acceptance
back, so a retry can genuinely re-attempt.

A recall is announced, not just performed. Taking a queued message back - a
recall, a queue clear, or pressing stop - now publishes the withdrawn identity
to every device, so another browser's bubble no longer waits forever on a
delivery that can never come. The frame is terminal: the line and its outbox
entry go, and nothing offers to re-send what the reader explicitly took back.
A withdrawal never names a delivered identity, and a device never deletes a
row the transcript already claimed.
