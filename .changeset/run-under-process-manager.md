---
"@gang-of-beads/pi-web": patch
---

The install guide now says how to keep `pi-web run` running under a process manager such as PM2 or supervisord: one copy, the stop signal to `pi-web run` only, and enough time for the session daemon's drain, with a PM2 command that sets this up (`--interpreter none`, without which PM2 reports PI WEB online while it never starts) and the supervisord settings.
