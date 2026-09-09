---
"@gang-of-beads/pi-web": patch
---

The phone's lists spent 90px of chrome - a fifth of what the keyboard leaves -
on two stacked bars before any content: the session bar and the panel header.
They are one bar now. The scope, the session, and a fold control share the
single 45px row; refresh, settings and the action palette live behind the fold
and come back with a tap. Measured on the 8505 stack: 90px to 45px folded, the
transient actions row 53px, the chat view's own single bar unchanged.

Nothing lost its one-tap path: the "Sessions" segment keeps the quick switcher
where the old bar's empty state had it, the scope chip still opens the context
sheet, and a working session still shows its dots - the indicator moved with
the bar it belongs to.
