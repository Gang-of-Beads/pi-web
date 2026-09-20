---
"@gang-of-beads/pi-web": patch
---

Returning from navigation works on the phone too.

The key only closed the overlay, so on the phone - where navigation is a main
view rather than an overlay - pressing it again did nothing. Leaving now hands
the main area back to the open session on both layouts, and where there is
nothing to return to, such as the desktop rail, the key stays a widen-only
key and says so.
