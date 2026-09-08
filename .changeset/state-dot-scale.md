---
"@gang-of-beads/pi-web": patch
---

State dots follow one scale. The same "this is working" motif shipped at 4, 5,
6, 7 and 8px with 2px and 3px gaps, so one screen could bounce a 6px triplet in
the context bar above a 4px triplet in the activity dock beside a 7px mark in
the status bar. `--pi-dot-xs|sm|md` names the three sizes, every mark reads
them, and a contract test fails the suite on a sixth.
