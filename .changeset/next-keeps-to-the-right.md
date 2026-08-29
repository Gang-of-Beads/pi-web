---
"@vincenthanxiaodu/pi-web": patch
---

On a question card the advancing button keeps to the right, even on the first question where Back is absent - the left edge is Back's spot whether Back is there or not.

A send whose confirmation frame was dropped no longer waits forever: while a card is still waiting, the disk is re-read on a slow cadence, and the refresh carries waiting cards across the rebuild instead of dropping them.
