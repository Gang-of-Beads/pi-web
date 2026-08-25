---
"@vincenthanxiaodu/pi-web": patch
---

Stop resurrecting subagent runs that already stopped. An active parent turn was treated as proof that every unfinished child was still working, so typing a message turned a graveyard of long-dead runs back into "12 running". Measured on a real session, children that were still alive had been quiet for under a minute and the dead ones for at least 139 minutes, so the quiet separates them and the parent's own state never did. A busy parent now widens that window instead of overriding it. A run that started, wrote, and then went silent without recording an outcome reads as "Stopped" rather than "Unknown", which said only that the outcome could not be read — as true of a run still in flight as of one that died.
