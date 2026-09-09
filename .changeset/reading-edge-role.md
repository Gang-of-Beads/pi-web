---
"@gang-of-beads/pi-web": patch
---

One reading edge. Lists, sheets and panels answered "how far from the screen
does text start" five different ways - 6, 10, 12, 15 and 16px coexisted on one
phone screen - because the spacing scale names arithmetic steps and nothing
named the role. A role token now does: --pi-reading-edge, 16px on desktop and
10px on the phone, derived from the scale at each breakpoint, and the shared
list row and the tools grid use it. The phone measures unchanged; the desktop
lists sit at the same edge the settings panels already had. A contract test
keeps the token published at both breakpoints and catches the next list that
answers the question privately again.
