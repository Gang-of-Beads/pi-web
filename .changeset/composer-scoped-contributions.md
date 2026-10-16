---
"@gang-of-beads/pi-web": patch
---

Text a composer plugin writes after you switch session or machine, such as a dictation still streaming, now goes into the draft of the session it started in instead of the one on screen. Composer plugins also get a `signal` that aborts when the composer leaves that session, so they can stop their work.
