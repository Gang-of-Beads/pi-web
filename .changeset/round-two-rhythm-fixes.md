---
"@gang-of-beads/pi-web": patch
---

More round-two polish. A session row's state mark had no position of its own,
so an 8px dot took a whole line under the subtitle and added 18px to every row
carrying one. Appearance cards clamp their description to two lines, so the
grid keeps one card height instead of three, and the "follow the system"
checkbox stays square on a phone instead of being squeezed to 15.8x24 by the
text beside it. Picker rows state their own type, which also retires the 1px
taller row the ✓ marker used to create, the quick switcher's group headings
align with the cards they label, and the thinking picker's last level carries a
description like every other level instead of collapsing a row.
