---
"pi-web": patch
---

The projects and workspaces pickers are now the bundled workspaces plugin's browser half, contributed into both switcher surfaces through a new `navSections` seam: the desktop navigation panel and the phone context sheet reserve the slots and keep the section order, keyboard machine, and collapse state, while the plugin brings the picker bodies and focuses them on the shell's behalf. The host feeds one context - the app snapshot, the label items, and the select/add/close/delete/trust actions - so the pickers never call a PI WEB API or spell a URL, and when the plugin is absent the slots render nothing. The plugin contract gains the nav section face, and the workspace trust checkbox now rides host-provided reads and writes instead of the plugin reaching for the API.
