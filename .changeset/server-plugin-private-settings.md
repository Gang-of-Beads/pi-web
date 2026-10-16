---
"@gang-of-beads/pi-web": patch
---

Give server plugins their private settings. A plugin's server half now receives its own `serverSettings` block as `context.serverSettings` when it is activated, in the web/API process and the session daemon alike; its browser half and every browser answer still never see it. Changing a plugin's private settings marks it **Restart required**, like changing its public settings, and the fingerprint used for that comparison is keyed with a random host-local key so it cannot be used to check a guessed secret.
