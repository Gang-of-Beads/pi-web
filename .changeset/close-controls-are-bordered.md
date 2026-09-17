---
"@gang-of-beads/pi-web": patch
---

Every close control wears a border.

The prompt-history sheet, the quick-access menu, the cleanup dialog and the
session tree each drew their close key as a bare glyph, which on a phone reads
as a stray mark rather than a control. They now draw the bordered box the rest
of the chrome uses, and a guard fails when any component in the directory
declares a borderless close control.
