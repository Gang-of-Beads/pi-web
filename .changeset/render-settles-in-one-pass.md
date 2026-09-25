---
"@gang-of-beads/pi-web": patch
---

The transcript stops re-rendering itself from inside its own render.

updated() assigned the jump-to-bottom flag on every render, and a @state write
schedules another render, so each pass re-entered the cycle. While a turn ran the
page rendered in bursts (30-60 renders a second on the seed session, measured
with the turn clock instrumented), and on a sixteen-thousand-message transcript
that is the pulse the page was visibly doing. The flag is assigned only when it
changes now, and a test pins one nudge to a single render.
