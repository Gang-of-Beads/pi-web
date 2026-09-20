---
"@gang-of-beads/pi-web": patch
---

Tapping elsewhere takes a row menu back.

The menu only closed through one of its own items or its toggle; a tap on the
rest of the board did nothing and left it hanging. A tap outside now
dismisses it, without also acting on whatever was under the tap.
