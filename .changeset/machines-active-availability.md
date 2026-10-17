---
"@gang-of-beads/pi-web": patch
---

The Machines list no longer shows a machine as Online after it went away. While a Machines list is open in Navigate or Settings, PI WEB checks every listed machine right away, then rechecks an Online machine every 15 seconds and a machine that does not answer sooner, backing off from 1 second up to 15 seconds; a machine that stops answering shows Trying after 10 seconds and Offline after 30 seconds, and turns Online again once it answers. Online now means both the machine's web/API server and its session daemon answered, also without the Machines plugin and in the fleet report; an answered error shows its reason instead. Checks pause while the list is hidden or covered by another dialog, and they do not change the chat's connection notices.
