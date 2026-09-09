---
"@gang-of-beads/pi-web": patch
---

Round-three lane C fixes. A failed command receipt referenced three tokens that
do not exist, so it lost the danger colour *and* the fill its pending sibling
has; the add-project dialog's hints were clamped to one nowrap line by the host
sheet, which pushed the project-trust link past the dialog edge where it was
clipped away entirely; and the settings back control kept the button surface as
a white block above the heading. Picker close controls are sized on both
pointer types instead of inheriting the user agent's 24x25, option descriptions
read the type scale, the theme preview dot joins the dot scale, the tile
activity dot sits in the slot reserved for it, the multi-select checkbox is
concentric with the toggle on touch as well, and the global error banner's
dismiss meets the control height. Control sizes hidden inside custom properties
are now caught by the same guard as the controls themselves.
