---
"@gang-of-beads/pi-web": patch
---

On Termux, a `umask` line in a PI WEB service's run script no longer stops `pi-web restart` and `pi-web doctor`, and `pi-web install` keeps it when it writes the script again.
