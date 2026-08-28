---
"@vincenthanxiaodu/pi-web": patch
---

Return a pinned reader to the bottom after a press that held the transcript still.

Opening a phone keyboard grows the transcript's scrollable range. Following that
growth while a finger is already down would move the control the reader is aiming
at, so it is suppressed - but the suppressed scroll was dropped rather than
deferred. Measured at 393x850, a reader pinned at 27612 of 27612 was left at
27612 of 27948 once the press ended: still short of the bottom they were pinned
to, with no later event to correct it.

The follow refused during a press is now applied when the press ends, after the
grace that lets the tap land. A reader who scrolled away during the press keeps
their position instead of being pulled back down.

The scroller also had no `pointercancel` binding, which is what a phone fires
instead of `pointerup` once a press becomes a scroll gesture. Every way a press
can end now releases the gate.
