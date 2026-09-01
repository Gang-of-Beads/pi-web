---
"@vincenthanxiaodu/pi-web": patch
---

Typing `/` offers commands again in a session whose workspace has not resolved yet. The composer looked up slash commands against the selected workspace's directory alone, and that lookup is guarded on a non-empty directory — so a session opened before its workspace listing landed (or a route restored session-first) silently offered no completions while the rest of the composer kept working. The composer now falls back to the directory of the session it is composing into.
