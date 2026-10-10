---
"@gang-of-beads/pi-web": patch
---

A half-typed answer in an extension's text question (pi's `input` and `editor` dialogs) is now kept with the session on its machine: a reload keeps it, and every device showing the question shows what was typed on another. It goes away when the question is answered or closed. Restart the session daemon and the web service, and reload the page.
