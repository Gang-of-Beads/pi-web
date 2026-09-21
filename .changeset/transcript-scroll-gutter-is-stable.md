---
"@gang-of-beads/pi-web": patch
---

The transcript stops jolting when a scroll ends.

The scroll rail grew from nothing to 6px with the gesture and shrank back
when it retired, so the content box changed width twice and every message
rewrapped. The gutter is now reserved at all times and only the thumb's
colour answers the gesture.
