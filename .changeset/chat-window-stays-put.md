---
"@gang-of-beads/pi-web": patch
---

A conversation whose rows are short enough to fit several screens of history in less than a phone screen no longer makes the page jump. The reader's window kept only 400 rows, which on such a session was shorter than the top prefetch, the viewport and the bottom prefetch together, so both ends stayed "near" at once: reaching the bottom loaded the tail and trimmed the top, reaching the top pieced the earlier rows back and trimmed the bottom, for ever. The window now keeps up to a thousand rows, which leaves room for both ends, so a session that reached both stops asking. Long histories still trim.
