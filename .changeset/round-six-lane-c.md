---
"@gang-of-beads/pi-web": patch
---

Round six, lane C. The tile activity dot was derived with a hard-coded 5px
radius from when the dot was 10px, so it sat 1px above the menu button it is
supposed to share a centre line with; it derives from the dot token now
(measured 1px, now 0). The message info control gets the same touch reach its
siblings have instead of standing as a 24px target beside 44px ones, and the
error banner's dismiss is a square control rather than a ~19px strip. The
follow-the-system checkbox loses the 2px margin left behind by an alignment
change, the add-project dialog's footer buttons use the app font like every
sibling dialog, the child-row indent reads the gutter formula, and a block of
list rules that had been copied into the composer — where nothing matches them
— is gone.
