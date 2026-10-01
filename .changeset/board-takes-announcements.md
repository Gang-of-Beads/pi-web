---
"@gang-of-beads/pi-web": patch
---

The session board and the quick switcher now update the moment a session is renamed or started on another device. Before, they kept the old name or missed the new session until the whole board was read again. A rename that arrives while the board is loading is no longer undone by the older answer. Reload the page to pick this up.
