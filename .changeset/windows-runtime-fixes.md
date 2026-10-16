---
"@gang-of-beads/pi-web": patch
---

Fix native Windows runtime basics: the session daemon listens on a named pipe derived from the data directory instead of a socket file Windows cannot open, the web server reaches the daemon even when the data directory path contains a space, terminals start PowerShell (`pwsh.exe` when installed, otherwise Windows PowerShell) when `SHELL` is not set, a project added by a Windows path is named after its folder, and the manual-run advice names the installed `pi-web-sessiond` and `pi-web-server` commands for an npm install, in PowerShell syntax on Windows.
