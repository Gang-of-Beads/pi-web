---
"@gang-of-beads/pi-web": patch
---

Session listing refreshes that changed nothing cost a verdict, not a payload.

The workspace session list re-fetched its whole payload on every focus,
resume and socket event even when nothing had changed. The listing now
carries a stateless revision (a hash recomputed from the fresh payload):
the refresh echoes the revision it stored, and an unchanged backend
answers `{ unchanged: true }` so the rows already on screen are kept
without a byte of listing payload or a state churn.
