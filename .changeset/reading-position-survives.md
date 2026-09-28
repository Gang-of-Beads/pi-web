---
"@vincenthanxiao/pi-web": patch
---

The transcript stops bouncing and stop losing the reader.

Two defects behind the owner's "偶尔回弹" and "莫名其妙弹到 session 中部":

- A follow scroll wrote its target and the *next* scroll event adopted it back,
  overruling a pin the reader's own wheel or finger had already dropped. The target
  is now matched by value *and* freshness, and never against an already-dropped pin,
  so a coincidental equality cannot drag the view down again.
- Restoring a session whose saved anchor row was no longer loaded retried by fetching
  history even when the reader had been following the bottom. That walked the view up
  to the top of the loaded window - mid-session on screen - and unpinned it. A reader
  who was at the bottom now lands at the bottom.
