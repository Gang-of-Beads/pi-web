---
"@gang-of-beads/pi-web": patch
---

The Updates page no longer hands you shell commands to copy or run. It shows the version you run, the latest release and when it was checked, how PI WEB was installed, and whether the web server and the session daemon run the installed version. Check now, Update to the new version, Restart web and Restart session daemon are buttons: an update or a restart asks first, then runs in a new terminal on the Terminal page so you can follow it. An install from the nix store is now reported as nix rather than as a local checkout; with an update command set for the services (`PI_WEB_UPDATE_COMMAND`), Update runs it, and without one the page says the install is managed by your nix configuration. Restart the web server and the session daemon, then reload the page, to pick it up.
