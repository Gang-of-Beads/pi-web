---
"@gang-of-beads/pi-web": patch
---

The context sheet covers the true viewport on phones.

The app shell is `position: fixed` with its top pinned to the visual
viewport's offset, which is non-zero on real phones once the page scrolls
under a collapsed URL bar. The sheet's `inset: 0` resolved against that
shifted shell, so its top edge sat tens of pixels below the real viewport
top and the page behind peeked out above the sheet. The sheet now renders
at the app template root and anchors itself to the dynamic viewport with
the shell offset compensated out, so it covers the whole screen wherever
the browser reports its viewports.
