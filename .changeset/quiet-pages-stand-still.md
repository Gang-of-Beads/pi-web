---
"@gang-of-beads/pi-web": patch
---

Scrolling back through a long session no longer jumps between the beginning and the end. A scroll forward reads the next page and extends the window instead of replacing it with the live tail (only the jump to the newest still does), an earlier page that arrives after the window has moved keeps the window instead of collapsing the transcript, a refresh or gap repair no longer pulls a reader who is reading history down to the newest messages, and the two boundaries only say "loading" for the page they are actually waiting on.
