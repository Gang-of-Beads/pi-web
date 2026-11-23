---
"@gang-of-beads/pi-web": patch
---

A machine this page reaches directly can be given its access token, so a page and a machine that both require a token can still talk: the token travels as an Authorization: Bearer header, since a cookie does not cross origins. The machine dialog asks for it on either connection, and the address of a page no longer needs to be trusted on its own.
