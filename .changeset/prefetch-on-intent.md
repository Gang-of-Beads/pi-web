---
"@gang-of-beads/pi-web": patch
---

A session opens from what was already read. Hovering or focusing a session row
is the earliest honest signal that it is about to be opened, so its first page
is read then and stored where opening looks for it. Measured on the 8505 stack:
after a hover, the click paints its first messages in 11ms. The prefetch costs
one read the click would have made anyway, failures are dropped rather than
raising an error for something nobody asked for yet, and on a touch screen
nothing changes because there is no hover to read.
