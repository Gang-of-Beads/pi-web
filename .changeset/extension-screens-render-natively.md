---
"@gang-of-beads/pi-web": patch
---

An extension screen renders as a card, not as a terminal frame.

`ctx.ui.custom` drew a framed TUI and the browser repeated it verbatim, so the goal
plugin's task-list confirmation arrived on a phone as box-drawing characters with a
key row under them. An extension can now say what its screen *is* — `ctx.ui.custom(
factory, { web: { kind: "menu", title, body, options } })` — and the browser draws
its own card: a heading, the proposal text pre-formatted, and the options as real
buttons with the current one marked. pi ignores the unknown key, so the terminal
keeps the component.

A screen that declares nothing is read by shape (a cursor with its sibling rows is a
menu), and one that matches neither stays monospace text with the key row, which is
still faithful and still tappable. The goal plugin's confirmation now declares its
card.
