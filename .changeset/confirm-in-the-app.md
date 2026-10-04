---
"@gang-of-beads/pi-web": patch
---

Deleting an archived session for good, deleting a workspace, closing a project, removing a machine, running session cleanup and running a task that asks first now confirm in PI WEB's own dialog, which names what is about to change, instead of the browser's confirm box. Plugins can ask for the same dialog through `ui.confirm`. Reload the page to pick this up.
