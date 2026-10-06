---
"@gang-of-beads/pi-web": patch
---

Shift+Enter in an extension's editor card now does what it does in the composer on a narrow window or a touch screen with a keyboard. An extension that writes the composer while a new session is starting now reaches it. The docs give the right default for `extensionDialogsTimeoutMs` (it waits until answered). Restart the session daemon, then reload the browser.
