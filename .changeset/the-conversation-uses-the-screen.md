---
"@vincenthanxiaodu/pi-web": patch
---

Let the conversation use the width of the screen, and keep the status dock in it

The transcript was capped at a 78ch reading measure and centred, so a wide
monitor showed a narrow column between two large empty margins. The column now
takes the width it is given and keeps a gutter at each edge. The status dock
was positioned against the viewport rather than the column, so "idle" sat far
to the left of every message it described; it now measures from the same
gutter. Transcript, composer and dock share one token, so they line up at every
window size instead of by coincidence.
