---
"@gang-of-beads/pi-web": patch
---

When an extension asks something PI WEB cannot show (for example a question whose text is too long, or a choice with no options), the conversation now says so and the notice is kept in the session's notifications, instead of nothing happening on screen. Restart the session daemon to pick this up.
