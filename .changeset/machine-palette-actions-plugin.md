"pi-web": patch
---

The machine palette actions belong to the machines plugin: add, refresh, open and remove now come from the plugin's contribution set, and the four selected-machine callbacks leave the runtime context in favour of optional, id-addressed `removeMachine`/`refreshMachine`/`openMachine` capabilities the host offers over its core selection engine. The published plugin contract stops transitively depending on the host runtime - the thinking-level union is mirrored locally with two-direction drift guards instead of re-exporting pi's type - and `@types/ws` ships as a real dependency because the server face's declarations reference it. The installed-package smoke knows the full declaration graph the contract now carries.
