---
"@vincenthanxiaodu/pi-web": patch
---

Clear a lost-connection banner as soon as anything reaches the server again

The banner a dropped connection leaves behind was withdrawn only when the
realtime socket reconnected. A failure raised by a request left the socket
untouched - a phone that slept, a tunnel that blinked, a web process
restarting - so nothing ever disproved the message and the only way to clear
it was to reload the page by hand.

Any successful request now reports that the server is reachable, and the banner
is withdrawn on that. A real failure is left alone: it is not a transport
problem and still waits to be read.
