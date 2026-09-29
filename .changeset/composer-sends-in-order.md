---
"@gang-of-beads/pi-web": patch
---

Messages sent quickly one after another from the same composer reach the agent in the order you sent them: each is saved at once and handed over after the previous one is answered. A message sent while a photo is still uploading is no longer silently dropped, and the send button stays usable. A message retried from the unsent list keeps the attachment handling it was composed with, instead of taking it from whatever the composer holds at the time.
