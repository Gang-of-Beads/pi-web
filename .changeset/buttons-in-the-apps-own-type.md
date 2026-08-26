---
"@vincenthanxiaodu/pi-web": patch
---

Give every button the app's type instead of the user agent's

None of the shared button rules set a font, so buttons fell back to Chrome's
13.333px in the platform UI face - a size on no scale, in a face that is not
the app's. It reads as almost-right, which is why it survived: 13.333px only
looks wrong beside real 13px text.

This is the same omission that made the navigation header 56px out of buttons
nobody had sized, so it is fixed in the shared sheets and held there by a test
rather than patched per component. No button in the rendered app now falls back
to the user agent's type.
