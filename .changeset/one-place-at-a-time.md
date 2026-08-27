---
"@vincenthanxiaodu/pi-web": patch
---

A phone shows one place at a time. The navigation panel had a rule that laid it out inside the navigation view and no rule that removed it anywhere else, so the session list sat above the conversation and left it a strip at the bottom.

A reply delivered twice is drawn once. Duplicate detection only ever looked at user messages.

A notice says what retires it. Withdrawing it was decided afterwards by matching the words against a list of known phrasings, so anything the list had not met — "HttpError" among them — stayed on screen while the session replied normally.
