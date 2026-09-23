---
"@gang-of-beads/pi-web": patch
---

A chat message no longer closes the open question form.

A message queued before the questions were posted was delivered a second
after the form appeared and voided it - the reader watched a form they had
never touched close itself and read "you sent a chat message instead of
answering". The form now stays: a message neither answers it nor disturbs it,
and the answers arrive later as their own turn.
