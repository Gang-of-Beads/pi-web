---
"@vincenthanxiaodu/pi-web": patch
---

Draw a list row as one surface instead of two boxes glued together

A row was two separately outlined boxes butted against each other: the body
carried `border: 1px 1px 1px 3px` and the overflow menu carried `1px 1px 1px 0`,
so their shared edge stacked into a hard vertical rule and the row read as a
table cell rather than as one thing to click. Selection painted both boxes,
which is what made the seam visible in the first place.

The border, the radius, the background, the hover state and the status rail now
belong to the row; the parts inside it are transparent. An unselected row has no
outlined children at all.
