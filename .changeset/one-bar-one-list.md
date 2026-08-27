---
"@vincenthanxiaodu/pi-web": patch
---

The terminal no longer shows two scrollbars on a phone. xterm draws its own,
and the panel was reserving a second, native one that scrolled nothing.

The session switcher's filter chips now list every project. They previously
listed only those whose workspaces had finished loading, so the row changed
under you as the responses arrived.
