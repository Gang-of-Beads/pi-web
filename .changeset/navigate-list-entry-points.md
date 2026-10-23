---
"@gang-of-beads/pi-web": patch
---

Browser plugins can now add to the Navigate page's Machines, Projects and Sessions lists: draw their own line on every tile (`listLabels`), add entries to every tile's menu (`listActions`), and group a list into sections (`listSections`). A plugin decides what it draws, offers and groups, for example disk use on a machine, "Open in editor" on a project, or projects by client; PI WEB keeps the tiles one height, puts plugin entries before Remove, Close project, Archive and Delete permanently, and folds and reorders the sections as it does the session sections. Session sections also apply in the session search. The Machines list takes only the plugins this PI WEB serves itself. With no such plugin, the lists look as before.
