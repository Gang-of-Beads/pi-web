---
"@gang-of-beads/pi-web": patch
---

The attach clip stops touching the message box.

It sat 2px from the inner corner, reading as stuck to the border. It now keeps
the same breathing room the text inside does, and the text reserves the clip's
width plus that room on both sides rather than a hard-coded 36px.
