---
"@vincenthanxiaodu/pi-web": patch
---

Hand the browser a short-lived token for live transcription

Live transcription connects from the page straight to Azure, because putting
this server in the audio path would add a hop to every syllable for nothing.
That means the page needs a credential - but not the subscription key, which
could be used for anything and would be readable by anyone who opened the
developer tools.

The key now stays on the server and is exchanged for a ten-minute token. The
token endpoint is derived from the same config the socket url is, so the two
cannot drift apart, and an upstream refusal is reported by status without
forwarding the body of an authentication error to a browser.
