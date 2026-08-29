---
"@vincenthanxiaodu/pi-web": patch
---

A dropped push frame no longer leaves the conversation lying. A send still waiting for its confirmation now rides across a transcript rebuild instead of vanishing without a failure, and while any card waits, the disk is re-read on a slow cadence — with a healthy socket and a visible page, nothing else would ever have re-read it, so a card could wait forever for a confirmation that had already happened.
