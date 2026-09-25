---
"@gang-of-beads/pi-web": patch
---

An outbox row tells the truth about itself.

The row took its state from the composer's global "sending" flag, so an unsent
row could read "Sending" while a message still on its way could offer "Retry" -
two states that cannot coexist. The state is per message now, and a message the
daemon confirmed leaves the outbox rather than lingering with actions that no
longer apply.
