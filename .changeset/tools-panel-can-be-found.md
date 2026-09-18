---
"@gang-of-beads/pi-web": patch
---

The tools panel can be found again on the desktop.

With no project chosen the shell gives the tool column up, but the edge control
still described the panel as open, and it painted as a 14px translucent sliver
at the window edge - so Files, Git and Terminal read as missing from both sides
of a desktop window, with no way back. The control now reports the state the
reader sees, opening it wins over the automatic surrender (the panel shows its
own "Select a project"), and a collapsed handle paints as a real bordered
control.
