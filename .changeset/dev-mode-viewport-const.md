---
"@gang-of-beads/pi-web": patch
---

`pnpm dev` and the screenshot capture script no longer crash on startup with `Cannot access 'PINCH_ZOOMED_SCALE' before initialization`: the constant is declared before the class that reads it while the element upgrades.
