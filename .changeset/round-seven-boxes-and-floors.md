---
"@gang-of-beads/pi-web": patch
---

Round seven. Dialog and picker close controls are border-box, so the glyph is
centred in the box the token sizes rather than in an inner box the border pushed
off-centre. The chat drawer header keeps its padding inside the control it holds
(52px before, matching the 45px the rail and resident bar share), the resident
bar draws the same rule weight as the header beside it, and its toggle icon is
16px like every other header icon. The orphan marker carries information at a
readable strength instead of `--pi-dim` at 0.65 opacity (~2.3:1), the
bulk-selection toolbar meets the mouse control height its neighbours have, and
the settings list, the add-project suggestions and the quick switcher's rename
actions state their own type and height rather than the browser's.
