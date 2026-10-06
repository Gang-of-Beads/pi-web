---
"@gang-of-beads/pi-web": patch
---

On a phone, the terminal's extra keys now sit at the bottom of the terminal, right above the keyboard, in two fixed rows like Termux: ESC, ^C, |, HOME, ↑, END, PGUP over TAB, CTRL, ALT, ←, ↓, →, PGDN. The arrows are always in view instead of off the end of a scrolling row. CTRL and ALT apply to the next key, from this row or from the phone's keyboard (CTRL then C sends Ctrl+C, CTRL then ← moves a word left), and arrows and page keys repeat while held. Reload the page to pick it up.
