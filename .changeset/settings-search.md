---
"@gang-of-beads/pi-web": patch
---

Settings can be searched.

The section list grows with every plugin that adds one, so it now has a search
field above it. The match forgives dropped letters ("sesdaemon" finds Session
daemon) and falls back to the section description, ranking name matches first.
A query that matches nothing says so rather than showing an empty list.
