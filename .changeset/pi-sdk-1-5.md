---
"@gang-of-beads/pi-web": patch
---

PI WEB now runs sessions on Pi 1.5 and needs Pi Coding Agent 1.5.0 or newer: a "Do not trust" saved for a project folder holds even when the folder has nothing that needs trust, extension renderers get pi 1.5's `keyText` and `keyHint`, TypeBox features outside JSON Schema (`Type.Refine()`, codecs) no longer constrain extension tool arguments, a model whose arguments are rejected reads pi's new wording, and a session with no saved or scoped model starts on OpenAI's new default, `gpt-6.1-sol`. Restart the session daemon and the web service, and reload open pages.
