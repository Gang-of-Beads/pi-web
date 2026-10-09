---
"@gang-of-beads/pi-web": patch
---

Subagent runs are now read only through the Subagents plugin. `GET /api/sessions/:id/subsessions` lists a session's tracked children and no longer includes subagent runs; read those with the plugin's `POST /api/plugins/subagents/runs.list`. The unused `/api/sessions/:id/subagent-runs/:runId/messages` and `/output` routes are gone. Restart the session daemon to pick it up.
