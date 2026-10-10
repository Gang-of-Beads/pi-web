---
"@gang-of-beads/pi-web": patch
---

The Anthropic subscription billing warning now appears exactly when pi's terminal shows it: for a session on pi's own `anthropic` provider with a subscription credential. PI WEB no longer guesses that a provider whose name starts with `anthropic-` is Anthropic; a provider an extension registers is that extension's to warn about. Restart the session daemon.
