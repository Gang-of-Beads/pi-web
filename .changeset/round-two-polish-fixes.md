---
"@gang-of-beads/pi-web": patch
---

Round-two polish fixes. In multi-select the inert subtree toggle covered the
row's checkbox — on a coarse pointer it covered it entirely — so a tap aimed at
the checkbox hit a control that does nothing; inert now means inert. The
cleanup entry meets the mouse control height its neighbours already had, the
cleanup dialog and the ask-user card raise their controls by pointer type
rather than container width, and the add-project and add-machine confirms use
the app's accent fill (7.5:1) instead of a border token pressed into service as
a fill (4.1:1). The unread count in a section heading is a badge like every
other count, both image lightboxes close at the same size, and the "+" glyph is
the same size in every add control.
