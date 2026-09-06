---
"pi-web": patch
---

The add-project dialog is now the workspaces plugin's too, opened through the host's dialog seam: the shell keeps the modal surface - focus, escape, backdrop, layer order - and the plugin hands in the form. The dialog's folder suggestions, the path's server-resolved trust read, and the create call ride new host context actions (`createProject`, `projectDirectories`, `projectTrust`), so the form never calls a PI WEB API or spells a URL. The core dialog and its app-state flag retire; the shell's add-project affordances (empty state, context switcher, action palette) run the plugin's reserved `add-project` action and hide when no plugin provides it.
