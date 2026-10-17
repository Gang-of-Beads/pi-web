---
"@gang-of-beads/pi-web": patch
---

Text a composer plugin writes after you switch session or machine, such as a dictation still streaming, now goes into the draft of the session it started in instead of the one on screen. A new session getting its id after it starts is not a switch: a dictation begun while it was still starting keeps writing into it, and words Stop hands back land in it. Composer plugins also get an optional `signal` that aborts when the composer leaves that session, so they can stop their work.
