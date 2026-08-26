---
"@vincenthanxiaodu/pi-web": patch
---

Ask one question at a time so the answer field stays above the keyboard

The question card laid every question out at once. On a phone that made it
taller than the screen, and the field being typed into sat below the virtual
keyboard: the only way to read your own answer was to dismiss the keyboard,
scroll to find the field, and open the keyboard again to keep editing.

Each question now gets its own step, with Back and Next between them and the
submit control on the last one. A single question still shows no navigation.
Measured on a 375x360 viewport - a phone whose height has been taken by the
keyboard - the card went from 509px to 354px and now fits, with no scroll
region of its own.
