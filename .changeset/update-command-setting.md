---
"@gang-of-beads/pi-web": patch
---

You can now save the command that updates a machine's PI WEB in **Settings → General → Updates**; the Updates page's Update button runs it in a terminal you can follow, and it wins over the services' `PI_WEB_UPDATE_COMMAND`. An install from a nix configuration with no command says so on the Updates page with a **Set an update command** button that opens that field, and a `nix profile install` is now updated with `nix profile upgrade`. The new-version popup no longer offers to copy a command: its **Open Updates** button takes you to the Updates page. Restart the web server and the session daemon, then reload the page.
