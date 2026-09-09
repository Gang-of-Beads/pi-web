---
"@gang-of-beads/pi-web": patch
---

Round 17 of the convergence review: the mechanical findings fixed.

The self-update banner's coarse 44px floor was dead - its base rule sat after
the media block meant to raise it - and the pointer-query guard that should
have caught it never checked the first rule of any media block. Both fixed;
the guard's blind spot was the reason the dead floor reached CI.

The reconnect banner no longer pastes itself into itself once per retry: its
detail is what the health read reported, never the banner's own previous
text. The error producers in the machine and session controllers now travel
with their retired-by mark, so a banner's lifetime is decided by the error
that set it rather than by whatever was cleared before it. Stale docstrings
and a dangling triage pointer repaired.

The banner retirement model, the rail's colour vocabulary, and three smaller
product questions are the owner's; they are recorded with evidence in the
round-17 triage page.
