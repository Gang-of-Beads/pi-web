---
"@gang-of-beads/pi-web": patch
---

Round 15 of the convergence review ran over the architecture wave and found
nine true findings; all are fixed.

The two that mattered most were lies the screen told. An idle session wore
three bouncing working dots forever, because the persistent mark's own display
rule beat the hidden attribute it was toggled with - the test asserted the
attribute, the screen showed the mark. And every idle row in the machine,
project and workspace lists carried an unread-class marker inside a hidden
wrapper, which the state rail's :has() selector could still see, lighting the
whole list's rail as if everything were unread. Idle now means idle in the
computed style, and the unread class belongs to rows that are actually unread.

The session tree dialog could freeze the page: the load call sat in the render
path, and once the module had settled every render scheduled another render
through a microtask, starving the macro task that paints. The load now fires
when the dialog first appears, outside render.

The rest: the fold button's dead padding override replaced with a real box,
the tile path line's assumed line height pinned, the collapsed composer
aligned to the conversation column instead of a private inset, the prefetch
write keyed to the machine it asked rather than the one selected at merge
time, a failed prefetch forgotten so the next intent retries, and a
load-failure banner that retires itself when a retry succeeds.
