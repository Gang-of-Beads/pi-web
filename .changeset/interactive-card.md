---
"@gang-of-beads/pi-web": patch
---

An extension's `ctx.ui.custom` screen can be declared as a generic interactive card, `web: { kind: "card", fields }`, with text, choice, input and confirm fields, required fields, and `custom()` resolving with `{ values }` keyed by field id. It replaces the questions-only `kind: "questions"` declaration, which PI WEB no longer draws: a screen still declaring it shows its terminal frame. Session daemon restart needed.
