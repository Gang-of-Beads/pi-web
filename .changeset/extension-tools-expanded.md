---
"@gang-of-beads/pi-web": patch
---

A pi extension that expands tool output (`ctx.ui.setToolsExpanded`, pi's Ctrl+O) now opens the session's tool cards in PI WEB, and what it draws from then on is drawn expanded, as in pi's terminal; `getToolsExpanded` answers what was set. An extension that tries to switch the theme (`setTheme`) is told PI WEB draws with its own themes, chosen in Settings, instead of "UI not available". Restart the session daemon and reload the page.
