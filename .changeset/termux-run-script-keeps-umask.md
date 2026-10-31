---
"@gang-of-beads/pi-web": patch
---

On Termux, an octal `umask` line after the exports in a PI WEB service's run script no longer stops `pi-web restart` and `pi-web doctor`, and `pi-web install` keeps it when it writes the script again, as long as the rest of the script is PI WEB's own.
