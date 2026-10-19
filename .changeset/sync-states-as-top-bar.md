---
"@gang-of-beads/pi-web": patch
---

While PI WEB is trying to reach its server, trying to sync with a machine, catching up on what it missed, or retrying after a connection problem, the top row no longer shows a connection notice ("Trying to reach…", "Trying to sync with…", "Syncing with…", "Connection problem. Retrying in the background…" or "Previous request was interrupted…"). The thin progress line at the top of the window sweeps instead, the same one shown while a session opens, and it stays visible above open dialogs. Screen readers still hear the sentence. Errors and other notices still show as text in the row.
