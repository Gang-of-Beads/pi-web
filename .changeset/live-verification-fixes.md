---
"@vincenthanxiaodu/pi-web": patch
---

Fixes from the live verification pass: a failing activity read no longer renders as "Nothing running right now." — the panel says the read failed and retries automatically; an unreadable goals directory now fails the goals read (HTTP 400) instead of answering a successful empty list that claimed "No goals recorded" over goals it could not see; the composer no longer stays collapsed after the dialog it stepped aside for is answered and removed (the loan is called back when its host is gone); the zoom-dialog sync survives a null handle before the editor first renders; and a command accepted while a reply streams now says "accepted — waits for the running reply to finish" in the ledger instead of claiming completion.
