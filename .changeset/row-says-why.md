---
"@gang-of-beads/pi-web": patch
---

The status row at the top now says why the machine you're using isn't answering. A server that answers with an error shows its own words, such as "Local: Project store is locked", instead of "Reconnecting…". A remote machine that doesn't answer is named ("prod-8504 is unavailable; reconnecting…"). A dropped connection still says "Reconnecting…". In every case PI WEB keeps retrying and the row goes away once an answer arrives. A remote machine is no longer called unavailable when it was PI WEB itself, or a proxy in front of it, that didn't answer.
