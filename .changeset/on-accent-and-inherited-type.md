---
"@gang-of-beads/pi-web": patch
---

Accent-filled primary buttons take their label colour from a theme's
`--pi-on-accent` instead of its background colour: a background is chosen to
sit behind content and promised nothing about carrying a label, and the shipped
dark theme measured 3.74:1 on its own primary buttons. Themes that do not name
it keep the previous fallback, so the token is additive. Picker option rows
inherit the app font instead of falling back to the browser's 13.3px Arial,
`small` reads the type scale instead of the UA's `smaller`, row menus meet the
touch floor in every list (not only tiles), and the message-meta control draws
the app's focus ring rather than a 1px border at 1.09:1.
