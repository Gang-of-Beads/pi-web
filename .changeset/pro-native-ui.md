---
"@gang-of-beads/pi-web": patch
---

The app's own look is the flat mono TUI - themes become departures from it.

Without a theme extension the app now renders the pro shape: the
monospace stack as the UI face, square corners on the published radius
scale, and no elevation - the shadow colours go transparent so every
box-shadow collapses without touching the rules that consume them. The
44px coarse touch floor stands. The theme contract gains optional
shape/typography stops (fonts and the radius scale) so a soft theme can
pin the rounded sans look it was designed with; a theme that omits them
inherits the pro shape. The default preference is the native look - the
appearance panel lists "Pro (native)" first even when theme extensions
are installed, and selecting it clears every theme token back to the
core's own defaults.
