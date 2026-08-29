---
"@vincenthanxiaodu/pi-web": patch
---

Reopening the quick switcher within half a minute serves the list the last open just fetched. Every open used to re-fetch projects, every workspace and every workspace's sessions — measured at 302 requests on this machine, where one project alone carries 291 worktrees — before the list appeared. Past the window the refresh still runs, so a rename or a new session shows up within half a minute.
