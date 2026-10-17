---
"@gang-of-beads/pi-web": patch
---

On Termux, the session daemon no longer fails to start once a plugin has private settings (`serverSettings`, such as the Voice key): Android does not allow the hard link PI WEB used to create its settings revision key there, and the key is now written directly instead.
