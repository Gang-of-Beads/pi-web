---
"@vincenthanxiaodu/pi-web": patch
---

Accept long extension-dialog prose in the browser. The daemon already bounds a dialog's title and message by the prose limit, but the client parser still held them to the tighter label limit, so a dialog with a long title failed session-status parsing and replaced the chat with "String field exceeds limit: title".
