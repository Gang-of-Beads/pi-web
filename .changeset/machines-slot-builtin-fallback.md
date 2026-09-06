"pi-web": patch
---

The context navigation's machines section becomes a slot: a plugin contributing a `machineSections` body renders there from a host-fed snapshot (roster, selection, per-machine activity flags) and acts only through host callbacks; with no contribution the shell's builtin machine list renders exactly as before. No plugin contributes yet - the machines plugin arrives in its own wave - so this changes nothing visible today.
