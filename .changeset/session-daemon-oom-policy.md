---
"@gang-of-beads/pi-web": patch
---

On Linux, when the kernel's out-of-memory killer ends a program an agent started, the session daemon and its other sessions now keep running: the session daemon's systemd unit, from `pi-web install` and from the Home Manager module, sets `OOMPolicy=continue` (systemd 243 or later). This does not cover systemd-oomd, which some distributions enable: it kills whole cgroups, so it can still end the session daemon. Existing installs get the setting the next time `pi-web install` runs; updating with `npm install -g` and `pi-web restart` alone leaves the unit unchanged.
