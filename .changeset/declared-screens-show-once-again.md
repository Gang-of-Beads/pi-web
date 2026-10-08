---
"@gang-of-beads/pi-web": patch
---

An extension that asks its questions as a PI WEB card, such as pi-goal's goal questions and its task confirmation, shows that card again, once. Since the pi 1.0.4 update the extension could no longer tell that PI WEB draws such cards, so each question first appeared as a terminal screen, whose Confirm did nothing, and the real card appeared only after Cancel. Restart the session daemon to pick it up.
