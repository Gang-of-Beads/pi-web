---
"@gang-of-beads/pi-web": patch
---

The built-in Workspace Tasks plugin is removed: the **Tasks** page that ran commands from a project's `.pi-web/tasks.json` is gone. Run those commands from a project terminal or ask the agent to run them; a `.pi-web/tasks.json` file is no longer read, and a `workspace-tasks` entry under `plugins` in the config is ignored.
