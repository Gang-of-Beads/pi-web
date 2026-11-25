---
"@gang-of-beads/pi-web": patch
---

A PI WEB that reaches another machine for you no longer stops contacting it for 10 minutes after that machine refuses its access token. It keeps asking, so a corrected token works on the next check instead of after a wait or a manual refresh. The machine card still says the token was refused.
