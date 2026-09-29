---
"@gang-of-beads/pi-web": patch
---

Extension screens can now appear as the native Questions card. An extension that declares its `ctx.ui.custom` screen as questions (`{ web: { kind: "questions", questions } }`) gets the same card `ask_user` uses: real options, a Custom choice when allowed, and Back/Next. The terminal frame is no longer shown first and you no longer have to close it. The extension receives the answers you sent, and the transcript names the options you chose. `ctx.ui.piWebScreens` tells an extension which declarations this host draws. The older menu declaration never reached the browser and has been removed. Restart the session daemon to pick this up.
