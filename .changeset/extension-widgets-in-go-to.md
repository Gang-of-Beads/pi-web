---
"@gang-of-beads/pi-web": patch
---

A pi extension that draws with `ctx.ui.setWidget` now gets its own key in Go to, and that key opens a page showing what the extension draws, as the terminal draws it above the composer. Nothing is drawn in the conversation or around the composer. The key is named after the extension: `piWeb.title` in its package's `package.json` if set, otherwise the package's name. An extension that a PI WEB plugin's page already fronts gets no extra key; pi-goal's widget, for example, belongs to Goals. Restart the session daemon and reload the page to pick it up.
