---
"@gang-of-beads/pi-web": patch
---

A message you send shows in the conversation at once like any other message. "Sending…" appears only when the machine has not answered within 1.5 seconds, with Take back, and "Queued" shows only while the session is working; "Received" is gone. Take back stays on a message until the agent has it, whether or not it wears a mark. Your messages keep the order the agent takes them in, including two sent quickly where only one has been confirmed. The first message to a session after the session daemon starts no longer waits for the session's extensions to load: the machine takes it at once and opens the session afterwards, and if the session cannot open, the message comes back to the composer with the reason. Restart the session daemon and the web service, and reload open pages.
