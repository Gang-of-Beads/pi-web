---
"@gang-of-beads/pi-web": patch
---

Bring pi's built-in slash commands to the web UI. `/settings`, `/hotkeys`, `/model [search]`, `/scoped-models`, `/thinking [level]`, `/resume`, `/copy`, `/login` and `/logout` open or act on PI WEB's own controls at once, even while the agent works. `/export [path]`, `/changelog` and `/trust` now run in the session. `/share`, `/import`, `/bug` and `/quit` say they are not available instead of "not implemented", and the `/` menu lists only the commands that work, with pi's descriptions and argument hints.
