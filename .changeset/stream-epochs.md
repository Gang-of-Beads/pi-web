---
"@gang-of-beads/pi-web": patch
---

After the session daemon restarts, or after it drops the replay buffer of a session nobody was watching, a browser catching up on that session now reloads it instead of silently skipping the messages it missed.
