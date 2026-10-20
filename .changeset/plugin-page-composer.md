---
"@gang-of-beads/pi-web": patch
---

A plugin's workspace page can now write the draft of the session on screen and send it as the reader, through `context.composer` (`draft`, `setDraft`, `insertText`, `send`). It works on a phone too, where the page replaces the chat and the composer is not shown: the session's stored draft is used, and the reader finds it in the composer on going back. A page's message goes like one sent with the Send button, at most once and kept sending while the machine can't be reached, and its details show "Sent with" the plugin. A page cannot run a command this way: words starting with `/`, or a `!` shell command, are not sent. See the plugin API reference.
