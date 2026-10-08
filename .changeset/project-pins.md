---
"@gang-of-beads/pi-web": patch
---

A session can now be pinned in its project as well as globally. On the Navigate page, inside a project, a session's ⋯ menu offers "Pin in this project": the session then stays at the top of that project's list, on every device that browses the machine. The existing pin is now called "Pin globally" and keeps a session in the machine-wide Pinned group. The two are separate: inside a project, Pinned lists only that project's own pins, and a globally pinned session sits in the project's list like any other. A machine still on an older PI WEB offers only the global pin. Restart the web service to pick it up.
