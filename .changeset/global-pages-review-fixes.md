---
"@gang-of-beads/pi-web": patch
---

Global pages review fixes. The machine's own terminals now work on remote machines too (they answered "Not Found" there); update the remote as well. Updates' Run opens the Terminal page at once, and if the command cannot be typed the shell is closed and the app row says so. "Go to terminal" (its shortcut, the action palette, a command's open link) opens the Terminal page again instead of Files. Switching machines no longer leaves another machine's page in charge of the right-hand column, a chosen global page shows even before it is offered (Updates while the status is still loading), and the desktop's panel edge control matches an open column that shows a global page. Restart the web process, then reload the browser.
