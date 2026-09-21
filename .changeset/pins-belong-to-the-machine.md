---
"@gang-of-beads/pi-web": patch
---

Pins belong to the machine, not to one browser.

A pin was kept in the browser's local storage, so the phone and the desktop
each had their own set and neither knew about the other. The machine that
holds the sessions now holds their pins: every device browsing it reads and
writes the same set, and the pins a device already had are handed over once
rather than dropped.
