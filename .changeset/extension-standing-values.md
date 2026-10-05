---
"@gang-of-beads/pi-web": patch
---

Pi extensions' standing UI now shows in PI WEB, as it does in pi's terminal: `setStatus` texts get a footer line of their own (tap it to read them in full), `setWidget` blocks sit above or below the composer with "Show all" past 10 lines (6 on a phone), the working row takes an extension's words and mark, a folded thinking block takes its label, and `setTitle` names the browser tab while that session is open. The session daemon holds these values, so every open browser sees them and a reload reads them as they stand. Restart the session daemon, then reload the browser.
