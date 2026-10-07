---
"@gang-of-beads/pi-web": patch
---

Goals and Subagents appear in Go to only when the session on screen has loaded the pi extension behind them (pi-goal, pi-subagents). Before, both keys showed even where the extension was never installed. A load error keeps the key so its page can say what went wrong, and with no session on screen the keys stay, since PI WEB cannot tell yet. A plugin's page can now say which extension surface it fronts (`fronts`, matching the surface its server plugin declares in `agentFacts.surfaces`) and is hidden the same way. Restart the session daemon and reload the page to pick it up.
