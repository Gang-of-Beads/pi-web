---
"@gang-of-beads/pi-web": patch
---

Add an optional access token for the web/API. With `PI_WEB_ACCESS_TOKEN`, `PI_WEB_ACCESS_TOKEN_FILE` or `access.tokenFile` set, PI WEB serves only a sign-in page and its PWA metadata until a browser signs in (a 30-day cookie renewed on use) or a program sends the token as a bearer or `X-PI-WEB-Access-Token` header. Rotating the token through the token file needs no downtime, `pi-web doctor` reports the gate, and a gateway reaches a gated machine with This server and that machine's token.
