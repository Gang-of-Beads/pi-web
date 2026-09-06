"pi-web": patch
---

Review round on the workspaces extraction: the add-project dialog closes when a create succeeds and stays open on a failure reason; unknown project or workspace identities answer the 400 not-found contract instead of leaking a 500; the desktop context-switcher slots dropped a collapse toggle the core pickers never had; the plugin adopts the shell's list and surface styles through the host seam instead of stale copies; and a workspace search left running is retired when its section is hidden, matching the projects picker.
