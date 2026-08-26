---
"@vincenthanxiaodu/pi-web": patch
---

Make the subagent disclosure control findable

The control that expands a session's subagents painted the same background as
the row it sat on and outlined itself in a border one shade off the row's own,
so the only thing separating a control from its surroundings was a line that
was almost the same colour. It was found by hunting rather than by looking.

It now carries a tint of its own instead of borrowing the row's, and says
"Show subagents" or "Hide subagents" on hover as well as to a screen reader.
