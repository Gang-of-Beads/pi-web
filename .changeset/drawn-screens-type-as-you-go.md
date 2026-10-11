---
"@gang-of-beads/pi-web": patch
---

The text field under a screen an extension draws for pi's terminal now types into it as you type: each character reaches the screen at once and deleting sends Backspace, so a picker that searches as you type (pi-prompt-history's) filters while you type, and Send presses Enter. An extension's `getEditorText` now answers empty after you send a message or command, as pi's editor empties on submit, so pi-prompt-history opens on your whole history instead of only the prompt it last loaded. Restart the session daemon to apply.
