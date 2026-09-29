---
"@gang-of-beads/pi-web": patch
---

A reply that was cut off now says which of two things ended it. If you pressed Stop, it reads "You stopped this turn". Anything else reads "Interrupted before it finished" (or "Interrupted while running <tool>"), followed by the provider's own words. This replaces the unclear "(the turn was stopped before it finished)". The session daemon records your Stop, so every device shows the same words, and so does the conversation after a reload.
