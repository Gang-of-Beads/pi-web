---
"@gang-of-beads/pi-web": patch
---

An extension's terminal screen that is not a menu now has a text field instead of the ▲ ▼ ⏎ Esc keys. Send types what you wrote into the screen and presses Enter, an empty field just presses Enter, and an input method (Chinese, Japanese, a phone keyboard) composes in it as in any other field. Tapping a line still selects it. Keys now reach a terminal screen the way pi's terminal sends them, so a real list such as pi-prompt-history's picker moves and selects instead of ignoring every key. Restart the session daemon to pick this up.
