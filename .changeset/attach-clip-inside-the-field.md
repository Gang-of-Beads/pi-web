---
"@gang-of-beads/pi-web": patch
---

The attach clip finally stays inside the field.

Two earlier fixes missed it: the clip was measured against the whole composer
wrap (hints included) rather than the input, and the coarse-pointer rule set a
fixed size after the clamp, so with the keyboard up - a 40px one-line field -
it stood 36px tall plus its gaps and crossed the border. The clip now lives in
a box that is only the field, and every rule that sizes it clamps against that
box; a guard fails if a later rule sets a fixed size again.
