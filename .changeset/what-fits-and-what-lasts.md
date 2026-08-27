---
"@vincenthanxiaodu/pi-web": patch
---

A session whose turn has finished but whose background work is still running
now says so in the session list. The server had been sending the count all
along; the client dropped it while parsing.

A draft survives a page refresh. It was saved on every keystroke but only read
back when the session changed, which a refresh is not.

The activity drawer gets three fifths of a phone screen and keeps its close
control in view, rather than covering the screen and taking the way out with it.

Machines and workspaces can be searched, like projects and sessions already
could. A project with dozens of worktrees no longer has to be scrolled.

Dialog text longer than the room it was given now scrolls instead of painting
over the answer buttons.
