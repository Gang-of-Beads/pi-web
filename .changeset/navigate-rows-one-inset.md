---
"@gang-of-beads/pi-web": patch
---

The navigation page stops being inset twice.

Its rows sat 16px from the edge while its own bar sat at 8, because the page
adopted the whole list stylesheet to get a row menu and inherited that sheet's
section padding with it. The row menu control and its panel are their own
stylesheet now, so a surface that wants a menu does not inherit a list.
