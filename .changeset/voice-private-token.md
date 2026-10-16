---
"@gang-of-beads/pi-web": patch
---

Voice keeps the Azure Speech key on the server. Put it in `plugins.voice.serverSettings.azureSpeech.key`; a key still in `plugins.voice.settings` keeps working, but the plugin's health now says browsers can read it and where to move it. Recorded dictation on an Azure install is uploaded with the same short-lived token live dictation uses, so it no longer fails with 401, and `streaming.tokenEndpoint` is no longer needed. A `streaming` setup that cannot stream now says why instead of quietly recording a clip: this includes a missing `url` and the `browser`, `openai-realtime` and `deepgram` protocols, which this version does not stream to, so installs that named one of those no longer fall back to recorded dictation. A dictation and its status line stay with the session it was started in, and switching session or machine stops it and releases the microphone.
