---
"@gang-of-beads/pi-web": patch
---

Control heights follow one scale. The step between the mouse height (32px) and
the touch floor (44px) had no name, so 30, 34, 36, 38 and 40 all shipped as the
same intention — a search field 6px shorter than the one in the next dialog, a
model chip taller than the icon buttons beside it. `--pi-control-height-comfort`
names it, every control-sized declaration reads the scale, and a contract test
fails the suite on the next control-sized pixel literal (text metrics carry a
recorded exemption).
