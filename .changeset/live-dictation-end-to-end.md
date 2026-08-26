---
"@vincenthanxiaodu/pi-web": patch
---

Wire live dictation from the microphone to the service

The last piece: token, socket, microphone and text, sequenced. Audio goes from
the page straight to the service, because a relay would add a hop to every
syllable for nothing; the page never holds the account key, only a ten-minute
token.

Azure's socket does not carry bare JSON - each message is a text frame of
headers, a blank line, and a body - so a decoder that assumed JSON would report
a broken socket for a service that was working. The order is asserted too:
asking for the microphone before there is anywhere to send audio makes a
browser request permission it may never use, and stopping keeps only settled
text, because the half-formed guess on screen is not something the speaker
said.
