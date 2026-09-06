---
"pi-web": patch
---

The bundled workspaces plugin declares `runs: web`, which its server half always was: without the declaration the catalog treated it as daemon-owned, so the web process neither activated its file routes nor published its browser module, and the pickers, dialog, and file endpoints went missing on any real deployment. Caught by the live 393x850 stack probe, which now covers the whole wave: pickers in the context sheet, the add-project dialog through the shell's dialog seam, project create, and file write/read through the plugin routes.
