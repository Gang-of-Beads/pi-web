---
"@gang-of-beads/pi-web": patch
---

A transcript no longer claims to be empty while it is still loading

"Empty" was standing in for two different states. A session whose history had
not arrived yet said "This session is empty" and offered to write the first
message, then dropped the history on top of it. Loading and empty are now
distinct, and the loading state belongs to the selection that started it, so
switching sessions while one is still arriving cannot make the other look empty.
