---
"@gang-of-beads/pi-web": patch
---

The Git panel no longer shows a red error when a status or diff read gets no answer; it says "Reconnecting…" where nothing is known yet, keeps what it showed, and its regular read tries again. Plugins get the same rule through `ui.readFailure(error, attempt)`, which says whether to retry quietly or show a refusal the server stated.
