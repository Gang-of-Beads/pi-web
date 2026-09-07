---
"@gang-of-beads/pi-web": patch
---

Plugin dialogs can request the `fullscreen` presentation: the host renders
them edge-to-edge with no card chrome, so content authored against a large
canvas survives direct load and refresh instead of being squeezed into the
centered overlay card. Default stays `overlay`.
