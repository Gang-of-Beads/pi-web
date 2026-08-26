---
"@vincenthanxiaodu/pi-web": patch
---

Tell a finished run apart from one that stopped owing a reply

A tool ran, returned successfully, and the run ended there: no assistant
message, no error record, every request a 200. The dock showed "idle", which is
exactly what it shows when a run finishes normally, so a turn that vanished and
a turn that completed looked identical and the only clue was that no answer had
arrived.

A recorded tool result with no assistant message after it means the model still
owes a response. That case now reads "ended without a reply" with its own
badge, so it can be seen and acted on instead of being mistaken for a finished
session.
