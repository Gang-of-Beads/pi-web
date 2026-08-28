---
"@vincenthanxiaodu/pi-web": patch
---

Say what an empty session is, and call it something a person can read.

A session nobody had spoken to yet showed a blank screen — roughly 1160px of
nothing between the header and the composer, which reads the same as a session
that failed to load. It now says it is empty and offers a control that puts the
cursor in the composer.

That same session was named after the tail of its id, so the header announced
"Session: 7c4dc82f" and offered to rename it by that number. Sessions waiting
for their first message are called "New session", and the id moves to the row's
detail line, where it still tells two of them apart. The header and the session
list now take that name from one place, so they cannot disagree again.

On a touch screen the action palette drew a keyboard shortcut badge on every
row — a label for a key that cannot be pressed, holding open 101px the titles
were being truncated to give up. The badges are for pointers that come with a
keyboard, and the title takes the width back.

The palette also listed itself, offering to open the surface already on screen;
that entry is gone while the shortcut that opens it from elsewhere stays. Action
names are sentence case throughout, and the search box uses a real ellipsis.
