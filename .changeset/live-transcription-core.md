---
"@vincenthanxiaodu/pi-web": patch
---

Add the protocol layer for live transcription

Dictation transcribed only after the recording stopped, so a long thought
arrived as a wall of text minutes after it was spoken. Live transcription needs
a different protocol per service, so this adds the part worth getting right
first: decoding each service's messages, accumulating the text they produce,
and deciding what an install has actually configured.

The two services disagree about what a delta means - one appends fragments, the
other re-sends the whole phrase - so that difference is held in one place
rather than in the composer. A socket protocol with no token endpoint is
refused rather than downgraded, because the only other way to authenticate from
a page is to ship an account key to it.
