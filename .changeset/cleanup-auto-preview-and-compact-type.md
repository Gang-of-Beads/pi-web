---
"@gang-of-beads/pi-web": patch
---

Cleanup previews itself, badges lead the meta line, and the phone type
drops a step.

The cleanup dialog opened with a dead Run button and no explanation
that Preview had to run first - the reader checked boxes, Run stayed
disabled, and cleanup looked broken. The dialog now previews itself on
open and re-previews when the valid request changes; Run enables as
soon as the preview lands. Dead-folder rows carry the badge at the
start of the meta line so every row aligns. The phone type scale drops
one step (base 13px, 12px meta floor holds) - the owner read the old
sizes as elderly-phone large.
