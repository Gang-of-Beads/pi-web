---
"@gang-of-beads/pi-web": patch
---

Dictation is now a plugin. Existing installs must move their `speechToText` and `azureSpeech` config blocks under `plugins.voice.settings`; the core config no longer names them, and an unconfigured install simply does not offer a microphone.
