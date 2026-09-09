---
"@gang-of-beads/pi-web": patch
---

Spacing follows the published scale: 582 declarations named their gaps in
pixels, including steps the scale does not have (3, 5, 7, 9, 14px), which is
how sibling rows ended up breathing differently for no stated reason. The
transcript's sticky headers now derive their offset from the same step as the
padding they hang off instead of repeating -26px in three places. A contract
test fails the suite on the next rhythm-sized literal; values that mix spacing
with layout maths or device insets, and reserves wider than the scale's top
step, carry recorded exemptions.
