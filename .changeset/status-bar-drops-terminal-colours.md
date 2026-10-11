---
"@gang-of-beads/pi-web": patch
---

An extension status that colours its text for the terminal now reads as its words in the status bar: pi-background-tasks' status showed `[48;2;183;223;255m bg 3 done …` instead of `bg 3 done …`. The same goes for a working message, a working indicator's frames, the hidden-thinking label and the title an extension sets. Restart the session daemon to pick this up.
