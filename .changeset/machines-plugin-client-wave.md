"pi-web": patch
---

The machine fleet moves into the machines plugin's browser module: the navigation section, the compact switcher and the add-machine dialog are now contributed bodies rendering from the host-fed snapshot, with the list, switcher and dialog elements living in the plugin and acting only through host callbacks. The machines slot no longer falls back to a core-rendered list - with the plugin absent the slot is honestly empty while the proxy and fleet routes degrade to the local machine - and the add dialog opens through the same dialog seam the add-project dialog uses. The shell keeps the selection engine, the section order, the keyboard machine, the collapse state and the URL machine dimension.
