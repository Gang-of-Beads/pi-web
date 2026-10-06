---
"@gang-of-beads/pi-web": patch
---

PI WEB now bundles and requires pi 1.0.4 (was 0.99.2). Sessions get pi 1.0's fixes, among them "Selected model is at capacity" errors being retried instead of ending the turn, and Bedrock and MCP OAuth fixes. pi 1.0.3 renamed the Azure provider from `azure-openai-responses` to `azure`: rename that key in pi's `auth.json`, `models.json` and `settings.json` (or `/login` again) if you use it. Restart the session daemon to pick up the new pi.
