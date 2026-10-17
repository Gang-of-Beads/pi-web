---
"@gang-of-beads/pi-web": patch
---

On Linux, a program an agent starts that runs the machine out of memory no longer takes every session down with it: the session daemon's systemd unit now sets `OOMPolicy=continue`, so the kernel's out-of-memory killer ends only that program instead of failing the whole daemon. Existing installs get the setting the next time `pi-web install` runs.
