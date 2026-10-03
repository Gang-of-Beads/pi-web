---
"@gang-of-beads/pi-web": patch
---

A message held back because you switched sessions before it went out now reads "Not sent" and marks its session as needing you, instead of looking like it was still being received. A waiting message whose stored time cannot be read is still shown with Retry and Discard. A browser reload picks this up.
