---
"@gang-of-beads/pi-web": patch
---

Remove the built-in Workspace Tasks plugin: a project no longer has a **Tasks** page, and the **Open Tasks** action is gone. PI WEB no longer reads a project's `.pi-web/tasks.json`; the file can stay where it is and is ignored, as is a `workspace-tasks` entry under `plugins` in the config. There is no replacement task runner: run those commands on the project's **Terminal** page, or ask the agent to run them.
