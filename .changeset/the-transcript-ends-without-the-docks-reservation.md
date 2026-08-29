---
"@vincenthanxiaodu/pi-web": patch
---

Give the end of the transcript back the room the floating dock was reserving.

The activity dock used to float over the scroller's bottom edge, and the transcript kept 64px of bottom padding so the last message would stay clear of it - both arrived together. The dock is an in-flow row below the scroller now, with its own margin, so the reservation was dead weight added on top: measured at 393x850, a reader scrolled to the end sat 80px above the dock - the message rhythm's own 16px margin plus 64px of reserved nothing, an empty band that read as a rendering fault.

The transcript again ends with the room it had before the dock existed: one space-7 of padding on top of the message margin, 32px from the last message to the dock. The two pill variants of the dock measure equal height for the same content at 1440x900 (23px both, line-height normal on both the div and the button - the button's `font: inherit` is what makes that true); on a phone the background-run pill is 44px because the coarse-pointer rule gives the only interactive dock state the app's 44px touch floor, by design, not because of line-height.
