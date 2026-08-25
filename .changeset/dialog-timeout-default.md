---
"@vincenthanxiaodu/pi-web": patch
---

Stop expiring extension dialogs by default. `extensionDialogsTimeoutMs` now defaults to `0` (wait for an answer) rather than five minutes. An expired dialog is settled with its kind's cancel value, which the extension cannot tell apart from a deliberate dismissal — so reading a long proposal on a phone for five minutes silently discarded it and reported it as the reader's own choice. A positive value still restores the safety valve, and dialogs are still settled when the run they belong to ends or is stopped and when the session ends.
