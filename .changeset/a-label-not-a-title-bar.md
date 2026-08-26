---
"@vincenthanxiaodu/pi-web": patch
---

Shrink the message header to the size of a label

Every message reserved 47px above its first word for one line of small text.
The height came from a 32px icon button rather than from the text, so the row
read as a title bar rather than as a label. The action button is now 24px, the
WCAG 2.2 AA minimum target size, and the header is 29px. The sticky offset
moved with it so the role label still shows while a long message scrolls.
