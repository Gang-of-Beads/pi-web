---
"@gang-of-beads/pi-web": patch
---

Restore the action palette's selection highlight, hover and disabled
dimming, and give the action-menu-panel items their coarse pressed state.

The Round E small-family insert consumed the `.options button` rule's
closing brace, so every following rule collapsed into dead nesting: the
palette's selected highlight, hover feedback, disabled dimming, coarse
single-column override and empty-state padding all measured dead at the
reader - keyboard users could not see which option was selected. The
brace is restored, and the action-menu-panel items join the coarse
pressed-state family.
