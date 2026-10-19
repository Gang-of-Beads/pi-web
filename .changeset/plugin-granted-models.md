---
"@gang-of-beads/pi-web": patch
---

Server plugins can call a model through the machine's own model registry and logins, without seeing a key, when you grant them one. List the exact `provider/model-id` names in `plugins.<id>.models` in the global config; a plugin without the list gets no model access. Calls are text only and bounded (at most 4096 output tokens, 60 seconds, two at a time per plugin), the session daemon logs each one, and the plugin's card in Settings shows each granted model's calls, tokens and the cost the provider reported since the session daemon started. A changed list takes effect after a session-daemon restart.
