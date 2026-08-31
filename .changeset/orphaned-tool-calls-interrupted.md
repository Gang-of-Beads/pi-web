---
"@vincenthanxiaodu/pi-web": patch
---

A tool call whose turn died (e.g. a daemon restart mid-tool) now displays as "interrupted" instead of "pending" forever: pending means work in flight, and with no live turn the result is never coming.
