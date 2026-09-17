---
"@gang-of-beads/pi-web": patch
---

An empty quick-access menu says which kind of empty it is.

"No sessions yet." was printed for four different situations: sessions still
loading, a failed read, a search that matched nothing, and a context path
narrowed to a scope that holds nothing. Only the last is about the chosen
scope, and it now says so and offers to widen back to every project; loading
and failure are named as themselves, so the menu never claims a machine is
empty when it merely has not been read.
