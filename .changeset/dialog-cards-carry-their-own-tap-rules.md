---
"@vincenthanxiaodu/pi-web": patch
---

Dialog cards carry their own tap rules. The transcript sets `touch-action: manipulation` and suppresses the platform's tap highlight for its buttons, but extension-dialog and ask-user option buttons live in their own shadow roots that those rules never reach - so they stayed eligible for the browser's double-tap-zoom click delay and painted the rectangular tap highlight. Both card components now declare the same two properties for their own controls.
