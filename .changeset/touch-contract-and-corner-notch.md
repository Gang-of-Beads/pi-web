---
"@gang-of-beads/pi-web": patch
---

Tapping a control no longer flashes the platform's dark blue block or waits out the double-tap-zoom delay. A shadow root inherits nothing, so each component had to declare `-webkit-tap-highlight-color` and `touch-action` itself and most never did — the session list, the project list, the quick switcher, the settings dialog and the app shell among them. The declarations now live once and every component includes them, with a contract test that fails when a component drawing a control omits it. A message card's top corners also no longer show a notch: the header is pulled flush with the card's edge, so it rounds by the card's radius rather than a smaller one.
