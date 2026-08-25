---
"@vincenthanxiaodu/pi-web": patch
---

Give the drawer's "Show N finished" control its full touch height. The coarse-pointer rule that raises it to 44px was written earlier in the stylesheet than the 30px base height it overrides, and a media query adds no specificity, so the base height won — the control stayed 30px on every touch device. Measured in a real browser; a unit test cannot see a cascade order.
