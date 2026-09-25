---
"@gang-of-beads/pi-web": patch
---

The transcript stops losing the bottom while an answer streams.

A follow-scroll moved the view 240px down while the answer grew 551px; the
scroll event it caused was read as the reader moving away, so following stopped
for the rest of the answer and every later line landed below them. Our own
follows are now marked, the last row is watched for growth before the paint, and
a scroll event that did not move the reader no longer demotes the pin.
