---
"@gang-of-beads/pi-web": patch
---

A link naming a session opens the conversation on a phone.

The phone layout returns to the picker when the workspace changes without a
session under it - correct for a tap, wrong while a route is still restoring,
which is when the workspace is set before the session it names has been
selected. At 209ms a shared link flipped from the conversation to the picker,
while the same link opened the transcript on a desktop.
