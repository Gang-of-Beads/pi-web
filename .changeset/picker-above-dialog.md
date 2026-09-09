---
"@gang-of-beads/pi-web": patch
---

A picker opened from the settings dialog is visible again. The layer tokens
rank kinds of surface — a popover sits below a dialog — so opening the theme or
model picker from settings dimmed the backdrop, painted the picker underneath
the panel, took Escape with it and left the dialog unclickable. A picker opened
over a dialog now says so and paints above it, while a picker opened on its own
keeps the popover layer.

Also: the rail header and the resident context bar share one height (45px, not
45 against 53), the message row's touch expansion clears the info control it
sits beside instead of claiming 2px of it, the context switcher's chip and add
control share one font, and the theme preview's nested corners are derived from
the corner and padding around them so the arcs stay parallel.
