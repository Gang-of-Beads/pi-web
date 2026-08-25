---
"@vincenthanxiaodu/pi-web": patch
---

Keep the Add project buttons on screen. The dialog never bounded itself to the viewport, so a long list of folder suggestions pushed its footer — the only way to finish adding a project — below the fold on a phone, and further still once the keyboard opened. It now uses the same viewport bound the other dialogs already set, and scrolls its body instead of growing past the screen.
