---
"@gang-of-beads/pi-web": patch
---

Publish the short-viewport breakpoint to plugins: `ui.breakpoints` now carries
`shortViewport` (max-height 620px) alongside the width and pointer axes, so a
contributed surface can respond to the keyboard-up, landscape-phone case the
width classes cannot see.
