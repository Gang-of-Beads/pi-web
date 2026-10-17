---
"@gang-of-beads/pi-web": patch
---

The Voice plugin no longer ships with PI WEB. It now lives in its own package; to keep the composer's **Dictate** control, install it with `pi install npm:@gang-of-beads/pi-web-voice` (the installer's Gang of Beads preset now includes it), then restart the session daemon and reload the page. Its plugin id stays `voice`, so existing `plugins.voice` settings and `serverSettings` keep applying unchanged. Its setup is documented in the [pi-web-voice README](https://github.com/Gang-of-Beads/pi-web-voice#readme).
