---
"@gang-of-beads/pi-web": patch
---

PI WEB installs on Windows. `pi-web install` registers the session daemon and the web server as per-user scheduled tasks that start when you sign in, run without a console window, restart after a failure and write their logs to `~/.pi-web/logs`, with no administrator rights. `uninstall`, `start`, `stop`, `restart`, `status`, `logs`, `doctor` and `version` work there too, and a new PowerShell installer (`irm https://raw.githubusercontent.com/Gang-of-Beads/pi-web/main/install.ps1 | iex`) checks the requirements, installs the package and runs `pi-web install`. Restarting from the Updates page restarts both services there through a short-lived scheduled task, and answers with an error when that task could not be started; applying an update from the browser says that it is not available on Windows yet. A config file saved with a byte order mark, as Windows PowerShell 5.1 writes it, is now read instead of rejected as invalid JSON.
