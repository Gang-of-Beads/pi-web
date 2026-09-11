---
"@gang-of-beads/pi-web": patch
---

Control chrome no longer selects its own labels on press-and-hold.

Tapping and holding the navigation, context bar, status bar or composer
toolbar used to pop the text-selection callout over buttons and labels -
chrome nobody copies. Those four surfaces now disable text selection
within themselves (the composer's own text controls explicitly re-enable
it), while message content, notices and code stay selectable per the
text-selection guideline.
