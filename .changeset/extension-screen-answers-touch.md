---
"@gang-of-beads/pi-web": patch
---

An extension screen can be driven by touch.

A TUI component draws a menu and says "Enter to select · ↑↓ to navigate", which is
true on a keyboard and useless on a phone - a <pre> raises no keyboard, so the
screen rendered perfectly and could not be moved. That is what the owner hit on
the goal plugin's task-list confirmation.

Every line is a row now: tapping one walks the component's own cursor to it and
selects, and a key row (▲ ▼ ⏎ Esc) covers screens whose choice is not a cursor.
