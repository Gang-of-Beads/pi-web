---
"@vincenthanxiaodu/pi-web": patch
---

Stop reporting a session that is waiting for you as idle. A run parked on an extension dialog — `ctx.ui.confirm`/`select`/`input`, including the update prompt that cancels itself after a few minutes — was shown as idle in the status dock, and was left out of the waiting set the session list and quick switcher read, because both surfaces looked only for an `ask_user` question set. Both now ask one question ("is this session waiting on the user?") that counts either kind.
