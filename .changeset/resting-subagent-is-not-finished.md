---
"@vincenthanxiaodu/pi-web": patch
---

Keep a resting subagent in sight. A subagent has no "done" of its own: it rests at "idle" between turns and can still be resumed. The activity list treated everything that was not actively working as finished, so an idle child was folded away under "Show N finished" and, in the full history, sank below every completed run because it carries no start time to sort on. A live session you could still open read as work that had ended. "Finished" now means only the states that really are terminal — done, failed, error — while the strip's "N running" count still reports just the work happening at this moment.
