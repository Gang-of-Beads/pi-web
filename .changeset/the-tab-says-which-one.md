---
"@vincenthanxiaodu/pi-web": patch
---

Name the browser tab and the navigation header after the focused context

Every tab and every panel header read "PI WEB", which is the one thing a reader
already knows. With several sessions open in several tabs, nothing in the tab
strip said which was which. Both surfaces now name the focused context - the
session being read, else the workspace, project, or remote machine - and fall
back to the product name only when nothing is selected.
