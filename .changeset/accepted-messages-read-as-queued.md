---
"@gang-of-beads/pi-web": patch
---

An accepted message reads as queued, not as a second Sent state.

The transport receipt (HTTP answer landed) used to show its own "Sent"
mark, so one message could sit between Sent and Queued and read as two
different things. The daemon owns a message the moment it answers, so
the receipt now wears the queue state it becomes: one Queued mark, then
Read when the agent takes it.
