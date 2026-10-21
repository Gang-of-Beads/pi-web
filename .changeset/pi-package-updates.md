---
"@gang-of-beads/pi-web": patch
---

The Updates page now lists the pi packages installed for the machine's user, says which have a newer version, and updates them from each row's own Update key or all at once. One pop-up per machine, "Updates on" and its name, now offers both PI WEB's own update and pi package updates, with "Remind me in" 1 hour, 1 day or 1 week, "Don't remind me about these versions", and a per-machine checkbox for the package lines. Plugins can end a list row in its own button or checkbox, and draw a checkbox on its own with `ui.renderToggle`.
