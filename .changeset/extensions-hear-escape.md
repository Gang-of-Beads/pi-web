---
"@gang-of-beads/pi-web": patch
---

Pi extensions that listen for Esc (`ctx.ui.onTerminalInput`) now hear it in PI WEB: Esc pressed in the chat view that nothing on the page used (no open dialog, menu or completion list) reaches the session's extensions as in pi's terminal, so for example pi-subagents can cancel a running `/subagent` and pi-goal can stop an audit. Other keys are not passed on. Restart the session daemon and reload the page.
