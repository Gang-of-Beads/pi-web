---
"@gang-of-beads/pi-web": patch
---

Visual-polish wave: three undefined design tokens stopped silently disabling
their declarations. The phone settings list drew descriptions and chevrons in
`--pi-text-muted`, which is defined nowhere, so every row rendered at title
brightness; accent-filled confirm buttons fell back to `white` at 2.5:1 on the
accent fill, and the add-project confirm inherited body text at 3.3:1 on its
green fill. Keyboard focus no longer squares off rounded buttons (the focus
rule inherited the parent's radius), message-row actions no longer overlap
their neighbours' hit boxes, and the rename dialog draws real fields and
buttons instead of platform defaults.
