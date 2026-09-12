---
"@gang-of-beads/pi-web": patch
---

The conversation meter no longer lets scrolled text bleed through.

The meter floated over the transcript's first visible line at 58%
opacity with no background, so the message text scrolling beneath it
showed through as clipped stray lines - read as broken rendering
mid-scroll. The meter now carries an opaque chat-background band and
only the indicator itself is translucent, giving the transcript's top
edge a clean boundary.
