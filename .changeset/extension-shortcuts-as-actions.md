---
"@gang-of-beads/pi-web": patch
---

Pi extensions' keyboard shortcuts (`registerShortcut`) now work in PI WEB: each shortcut of the open session is an action in the Actions palette under Extensions, named by its description and its extension, and running it runs the extension's handler as in pi's terminal. Its key is bound too, unless PI WEB already uses it, it has no Ctrl, Cmd or Alt, or it has Ctrl or Cmd alone (those belong to the browser); Settings → Shortcuts can give it another. A handler that fails says so in the conversation. Restart the session daemon and reload the page.
