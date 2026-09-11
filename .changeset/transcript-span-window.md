---
"@gang-of-beads/pi-web": patch
---

Long reading walks stop pinning every loaded row to the DOM.

The in-memory transcript span is capped at four pages: when a merge
pushes it past the cap, the far side from the reader's current focus is
dropped from memory while the full span persists in the history cache.
Scrolling back to an evicted side reloads it from the cache, not the
wire, and the existing "Load earlier messages" boundary stays honest.
When the reader is at the live tail, the newest side is kept - the
oldest side is the one to let go, and vice versa while walking history.

When the span is trimmed at the bottom, the transcript now says so: a
"Load N newer messages" boundary appears, transcript events that arrive
while the tail is trimmed park on it instead of silently appending
after an invisible gap, and tapping it reloads the live tail.
