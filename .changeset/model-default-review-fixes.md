---
"@gang-of-beads/pi-web": patch
---

If pi cannot save the model you switched to as the default (a settings file it cannot read or write), the conversation now says so instead of the next session quietly starting on the old model. A switch no longer undoes a model-scope change made meanwhile in another session. Back on a phone closes the model picker without moving to another session, and enabling a model in the picker no longer repaints a picker reopened for another session. Restart the session daemon, then reload the browser.
