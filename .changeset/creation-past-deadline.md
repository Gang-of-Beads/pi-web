---
"@gang-of-beads/pi-web": patch
---

Keep a new session creating when its machine takes longer than the request deadline to start it, for example while a startup extension waits on a question. The row keeps saying it is creating, its startup question stays on screen and answerable, and the page asks again under the same creation instead of reporting a failure; after a reload, a new session with a queued message or a draft comes back the same way. The machine answers every repeat with the one session it is making, so retries no longer create extra sessions, and the first message is sent once, to that session. A refusal, or a machine that no longer lets the page in, still says it failed and why. Restart the session daemon to apply; until it is restarted, a create that outlasts the deadline fails as before.
