---
"@gang-of-beads/pi-web": patch
---

On Termux, when `pi-web restart` or `pi-web doctor` refuses a termux-services run script that was edited, it now names the line that does not fit, such as an added `umask 077` or a line PI WEB writes differently, and says where a line of your own belongs instead: in the startup file of the login shell the service starts through. The FAQ has the repair steps.
