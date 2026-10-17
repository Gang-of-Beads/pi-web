---
"@gang-of-beads/pi-web": patch
---

Remove the built-in Workspace Tasks plugin: a project no longer has a **Tasks** page, and the **Open Tasks** action is gone. PI WEB no longer reads a project's `.pi-web/tasks.json`; the file can stay where it is and is ignored. A `workspace-tasks` entry left under `plugins` in the config does nothing: **Settings → PI WEB Plugins** lists it as configured only, with no package; delete the entry from the config file to drop the card. There is no replacement task runner: run those commands on the project's **Terminal** page, or ask the agent to run them.
