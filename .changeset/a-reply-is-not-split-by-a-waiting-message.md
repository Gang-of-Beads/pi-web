---
"@vincenthanxiaodu/pi-web": patch
---

A reply is no longer split in two by a message sent while it is being written. Streaming text was appended to whatever line was last, so a message sent mid-reply became last and the rest of the reply started a second assistant message — the transcript showed half an answer, then the message, then the other half.

Dictation says what it is doing. Every voice state, including a microphone that could not be opened and a permission that was refused, was written only into the button's tooltip, which a phone never shows: pressing the button and getting nothing back was indistinguishable from the feature not working.

The shell uses the height the browser reports as visible rather than assuming what `100dvh` excludes.
