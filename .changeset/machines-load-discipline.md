"pi-web": patch
---

The machines roster carries the same four-state load discipline as projects: `machinesLoad` moves through loading to loaded, and a failed listing keeps the previous roster on screen, sticks until a load succeeds, and feeds the retry and deep-link retention work that follows. No surface reads it yet, so nothing user-visible changes.
