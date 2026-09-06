---
"pi-web": patch
---

The phone keeps its own shell in landscape, and an empty chat never blocks it

Two phone reports landed in the same place. A camera return can leave the
page in landscape, where the width-only breakpoint handed the phone the
desktop shell squeezed into its height; the navigation layout now follows
the coarse-or-mobile rule the rest of the app already uses, so a
coarse-pointer device keeps the phone shell at any size. And the system
back gesture out of a tool panel could land on the empty "Select or start
a session." page - a dead end under touch; a phone with no session
selected now shows the navigation panel instead, matching what boot
already does. Desktop keeps the empty state, where the panel is always
on screen.
