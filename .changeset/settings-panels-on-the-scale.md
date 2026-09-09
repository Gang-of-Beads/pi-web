---
"@gang-of-beads/pi-web": patch
---

Settings panels join the control scale. Sixteen panel files had grown their own
form styles with no control height and no coarse-pointer floor between them, so
one General screen shipped a 40px input above a 42px select above a 35px save
button — the control a finger has to hit, 9px shorter than the close beside it.
A shared `settingsControlStyles` sheet gives every panel the scale and the
touch floor, and a panel writes only what makes it different. The add-project
dialog sizes its checkbox, path field and footer buttons on a mouse as well as
on touch, row overflow menus and the model picker's scope control take the
comfort height their siblings use, and the context sheet keeps the "Machines"
and "Workspaces" headings the phone panel drops — that panel has a row above
naming the step, and the sheet does not.
