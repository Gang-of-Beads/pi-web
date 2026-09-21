---
"@gang-of-beads/pi-web": patch
---

A picked theme outranks the system preference.

Choosing "Pro (native)" on a device whose system prefers light stayed light:
the stylesheet's light block overrode the base dark values, and the picked
look only removed its own. The dark side now sets its values like the light
one does, with a guard that keeps both copies equal to the stylesheet.
