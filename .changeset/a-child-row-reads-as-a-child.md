---
"@vincenthanxiaodu/pi-web": patch
---

Make a subagent row read as subordinate to the session that started it

A child row and its parent were drawn identically - same height, same type
size, same weight, same colour - with 16px of indent as the only difference.
Even that inverted: a parent reserves a gutter for its disclosure control, so
the child's name began 12px further left than its parent's and read as the more
important row.

Depth is now marked on the row itself, and the child is drawn lighter rather
than smaller: the type size stays on the scale while colour and indent carry
the relationship.
