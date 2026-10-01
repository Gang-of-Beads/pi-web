---
"@gang-of-beads/pi-web": patch
---

A pinned session no longer disappears when you close its project. Pinned used to list only sessions from open projects, so closing a project silently dropped its pinned sessions from the list, even though the pin was still stored. Pinned now finds every pinned session on the machine, and tapping one opens it without reopening its project; the page and its address then name that session alone, not the project you were in, and reloading opens it again. A pinned session that was deleted is not shown. Renaming a session from another machine's list now renames it on that machine. This machine's web server needs a restart; the session daemon does not.
