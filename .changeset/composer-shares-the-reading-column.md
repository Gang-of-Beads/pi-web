---
"@vincenthanxiaodu/pi-web": patch
---

Give the composer the transcript's reading column. On a wide screen the messages were supposed to sit in a centred 78ch column while the input box stretched edge to edge, but the centring `margin-inline: auto` was written with the same specificity as the message margin shorthand that followed it, so the shortcut always won: the transcript pinned to the left edge (it never centred at any width) and the composer spanned the whole window - two unrelated columns. The message margin now centres explicitly, the composer's footer joins the same 78ch measure, and a live check mounts a real chat-view and prompt-editor to hold the shared edge.
