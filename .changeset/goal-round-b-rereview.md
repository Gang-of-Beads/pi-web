---
"@gang-of-beads/pi-web": patch
---

The re-review wave: empty states that actually center, theme cards that
keep their height, boundaries for the buttons on raised cards.

Two Round A claims failed pixel verification and are fixed properly: the
new-session empty state's `margin: auto` resolved to zero in the block
scroller (the state never centered), and the settings-controls height pin
crushed the Appearance theme cards to 32px across three breakpoints - the
cards are buttons, so buttons keep min-height while inputs and selects
stay pinned. The tasks and relays viewers fill their panels so their
dashed empty states center for real. The re-review's own finds: five more
borderless touch controls get pressed states (the family is complete per
the stylesheet scan), the extension card's buttons gain a boundary on the
raised surface they sat darker than, the panel's fold-expanded actions row
joins the header's reading edge, and the message-header dividers lose
their sub-perceptible alpha mix.
