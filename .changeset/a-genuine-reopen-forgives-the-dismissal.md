---
"@vincenthanxiaodu/pi-web": patch
---

Let a dialog the daemon genuinely opens again survive the dismissal it was shown under.

A dialog this browser settled is remembered so a status snapshot taken before the close cannot re-open it and cost a second tap. But the memory had no expiry in the other direction: a live `dialog.opened` for the same id did put the card back on screen, and the very next status frame - stale or fresh - filtered the id out again and wiped it. A genuine re-ask therefore flashed for one frame and never came back.

A live open is newer news than any snapshot, so it now also forgives the dismissal: the card shows, the memory drops, and the next status frame that carries the dialog agrees with what is on screen. A stale snapshot without the dialog still cannot resurrect a dismissed one - that contract is pinned alongside.
