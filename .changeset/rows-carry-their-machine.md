---
"@gang-of-beads/pi-web": patch
---

A session row belongs to the machine it was listed under.

Browsing another machine, the board listed the selected machine's sessions
under the browsed machine's name, so opening one asked a machine that had
never heard of it and answered "Session not found". Rows and pins now come
from the machine being browsed, and a failure the reader has to retire
carries Retry beside the dismissal.
