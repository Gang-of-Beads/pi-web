---
"@gang-of-beads/pi-web": patch
---

The line at the top now tells a connection problem from a failed action by what actually happened, no longer by how the error was worded. When the web process cannot reach its session daemon because nothing is listening, or the gateway cannot reach a remote machine, the error answer now says so in a `transport` field. The page shows "Trying to sync…" for those, and for a dropped connection or a request that ran out of time, and clears the line once the link answers again. Any other failure keeps its own words, even when they happen to mention a timeout. Machines running an older PI WEB are still recognised by their wording. Restart the web service to pick this up.
