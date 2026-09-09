---
"@gang-of-beads/pi-web": patch
---

Round six, lane B. The quick switcher's interrupted ring drew at 12px because
it added a 2px border to an 8px content box, which also pulled its centre 2px
away from the corner every other state mark shares; it is border-box like the
house rings. The ask-user card's header starts on the same column as the
question, options and buttons beneath it instead of 6px to their left, and its
custom-answer block hangs from a derived indent rather than a 32px literal that
assumed a browser-sized radio. Native tick boxes in the ask-user card and the
model picker's catalog take the checkbox token instead of rendering at the user
agent's 13px, and the machine row menu is a published control size on a mouse
rather than 26px.
