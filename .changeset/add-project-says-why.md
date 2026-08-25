---
"@vincenthanxiaodu/pi-web": patch
---

Say why adding a project did not work, where it was attempted. A failure was reported through the global banner while the dialog stayed open in front of it, so submitting a path that does not exist looked like the button did nothing — and the message, when it could be seen at all, was a raw `ENOENT ... realpath` string. The dialog now shows the reason itself, in words that name the next move ("Tick 'Create the folder if it does not exist'"), and the button reports that it is working.
