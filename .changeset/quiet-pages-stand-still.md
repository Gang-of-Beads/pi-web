---
"@gang-of-beads/pi-web": patch
---

Scrolling through a long session no longer jumps between the beginning and the end. Scrolling down through history reads the next page and extends the window instead of replacing it with the newest messages; only the jump to the newest still does. An earlier page that arrives after the window has moved keeps the window instead of collapsing the transcript, and a refresh or reconnect no longer pulls a reader who is reading history down to the newest messages. The captions say "loading" only for the page on its way: above the window, "Earlier messages load as you scroll up", and below it, how many newer messages are there.
