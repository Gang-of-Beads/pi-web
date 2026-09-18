---
"@gang-of-beads/pi-web": patch
---

Navigation rows stop moving under your thumb.

The page refreshes from live events, and recency order let an arriving event
lift a row past the one being aimed at. While the page is open the order it
opened with is held: rows keep their places, new sessions append, gone ones
drop, and the state inside each row still updates. Closing releases the hold.
