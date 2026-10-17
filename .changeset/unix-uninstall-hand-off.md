---
"@gang-of-beads/pi-web": patch
---

`pi-web uninstall` run in a PI WEB terminal on Linux or macOS now finishes: it hands the work to a transient systemd user unit or a one-shot LaunchAgent job outside PI WEB's services, which writes to `~/.pi-web/logs/uninstall.log`, instead of stopping the session daemon under itself halfway through. It returns before that work ends, so wait for the log before running `npm uninstall -g`. On Linux without a user service manager, such as WSL without systemd, it refuses inside PI WEB and asks to be run outside; Docker deployments uninstall in place as before.
