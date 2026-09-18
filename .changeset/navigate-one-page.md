---
"@gang-of-beads/pi-web": patch
---

One navigation surface replaces the sheets you could not get back from.

Where you are - machine, project, folder - is now a path at the top of a single
page, and the page holds everything reachable from there: pinned sessions,
what waits for you, what is working, the rest, and the level below. Tapping a
level on the path widens; tapping a choice narrows; neither leaves the page.
Opening a session is the only thing that does. Sessions carry derived tags -
machine, project, folder, state - so `#waiting` or `#pi-web` filters the list.
On a phone the page opens over the session from the menu key and closes back
to it; without a session it is the page itself, with New session and Add
project on it. On desktop it is the left panel.
