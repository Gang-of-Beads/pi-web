---
"@gang-of-beads/pi-web": patch
---

Pressing Stop now always leaves one line in the conversation saying "You stopped this turn". This includes a Stop pressed before the reply wrote anything, while a message was being handed over, or while pi was waiting to retry a failed request. A stopped slash command no longer also reports that it finished without output.
