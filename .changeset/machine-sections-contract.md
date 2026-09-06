"pi-web": patch
---

The plugin contract gains a `machineSections` contribution point: a plugin can bring the machines section of the context navigation the way workspaces brings the project and workspace pickers. The shell reserves the `machines` slot and keeps the order, keyboard machine, collapse state and tile display; the section renders from a host-fed snapshot (roster, selection, per-machine activity flags) and acts only through host callbacks. Nothing consumes the point yet - the machines plugin arrives in its own wave.
