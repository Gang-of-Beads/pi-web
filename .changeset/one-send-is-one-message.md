---
"@vincenthanxiaodu/pi-web": patch
---

Stop one send with an attachment from becoming two messages

Attaching a file is asynchronous: it is read to base64 before it joins the
composer. Pressing send inside that window sent the text on its own, because
the composer still held no attachments - and the image, landing a moment later
in a composer whose text had just been cleared, went out as a second message
with no body at all. In the transcript that reads as one text message followed
by a bodiless image, which is why "I only sent it once" looked wrong.

A send now waits for a file that is still being read, so one submission is one
message.
