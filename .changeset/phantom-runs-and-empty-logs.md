---
"@vincenthanxiaodu/pi-web": patch
---

Stop listing runs that never happened. A subagent that died before writing anything left behind the empty directory the tool had made for it, and a neighbouring `forks` directory holds conversations rather than runs; both were reported as agent runs. They claimed to be "running" for as long as the parent session was, counted themselves into the drawer header — five phantom runs made it read "Activity · 5 running" while nothing was running — and answered "No output for this subagent run" in a red banner every time one was opened. A directory is now only a run when it has left an attempt to read or a result to show. A real run that still has nothing to show opens empty and says so instead of raising an error, and a run that genuinely could not be reached still reports that.
