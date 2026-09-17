---
"@gang-of-beads/pi-web": patch
---

The context path announces a group of choices, not a listbox it does not implement.

Its options were buttons labelled `role="option"` inside a `role="listbox"`,
which promises roving focus and `aria-activedescendant` that were never there,
so the announced widget behaved unlike the one screen readers described. The
level is a labelled group of toggle buttons now, each saying whether it is the
current choice, which is what the markup actually does.
