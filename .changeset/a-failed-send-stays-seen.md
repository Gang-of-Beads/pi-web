---
"@vincenthanxiaodu/pi-web": patch
---

Keep a failed send where it happened. When a message could not reach the server the bubble was withdrawn and only a bare error banner remained: the text vanished from the transcript, so the natural reaction was to retype it, and when the automatic outbox retry then landed, the message ended up sent twice. The bubble now stays in place marked "Not sent", and the outbox retry reuses the message's own correlation id, so the retry revives that same bubble - it reads "Not sent" while the network is down, then advances to sent once the retry lands. One message, one bubble, one place to look. A genuine server rejection still withdraws the bubble, because the composer restoring the text is the actionable home for it.
