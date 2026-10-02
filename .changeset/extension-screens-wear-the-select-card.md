---
"@gang-of-beads/pi-web": patch
---

Extension screens no longer look like a terminal dump, and no longer hide other dialogs. When an extension draws its own terminal screen that is a menu, it now shows as the same card as other choices: the screen's own first line as the heading, its options as buttons with the current one marked, and Cancel. Tapping an option selects it. Only a screen that is not a menu keeps its text and the key buttons.

Every open dialog now shows at once, oldest first, so a dialog waiting behind another (an update prompt, say) no longer appears only after the first one is closed. A screen's card also follows the extension as it redraws.

A browser reload is enough.
