---
"@gang-of-beads/pi-web": patch
---

Second polish wave across the overlay family. Quick switcher tiles reserve the
menu button's width once instead of twice, so a session name keeps the room a
140px tile has and the title and subtitle end at the same edge; the menu button
is one rule rather than a dead 40x52 base under a 32px override, and the
session state mark moved out from under it, where tapping the state opened the
menu. Project and workspace tiles put the activity dot on the menu button's
centre line (it sat 10px above it). The machine dialog and the machine row menu
get the coarse-pointer floor their siblings already had, the add-project footer
keys its floor to pointer type rather than viewport width, and the model and
command pickers draw a focus ring on the search field and the option list
again. The refresh control matches the header controls it sits beside instead
of standing 8px shorter.
