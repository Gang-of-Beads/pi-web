---
"@gang-of-beads/pi-web": patch
---

The attach clip stays inside a one-line composer.

On a short viewport the box is 40px while the control plus its gaps needs 44,
so the clip spilled over the border - the overflow reported twice. It shrinks
with the box instead of overflowing it.
