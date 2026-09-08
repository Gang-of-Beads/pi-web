---
"@gang-of-beads/pi-web": patch
---

Every corner in the client now comes from the published radius scale. Literal
radii had beaten the tokens — 8px appeared 44 times and the off-scale values 5,
7, 10 and 14 together appeared more often than `var(--pi-radius-lg)` was
referenced at all, so four curvatures could stack inside one dialog and moving
a token moved only half the app's corners. A contract test keeps the line:
a client surface that declares a pixel radius fails the suite.
