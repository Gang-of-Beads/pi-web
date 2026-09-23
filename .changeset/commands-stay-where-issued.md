---
"@gang-of-beads/pi-web": patch
---

A slash command bubble stays where it was issued.

It was drawn only in the transcript tail, after every message, so a /goal that
started the turn sat under the reply it caused and read as something still
waiting. Commands are placed by issue time now; only one newer than everything
on screen stays in the tail.
