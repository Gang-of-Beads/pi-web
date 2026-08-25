---
"@vincenthanxiaodu/pi-web": patch
---

Leave a failed send in exactly one place. A send that failed put the message in two: the optimistic bubble stayed in the transcript reading "Not sent" while the same text was handed back to the composer — and the outbox, the one mechanism that retries by itself when the connection returns, was never reached, because the controller reported the connectivity failure instead of throwing it. A dropped connection now goes to the outbox and the bubble is withdrawn (so a successful automatic retry cannot end up sitting under a stale "Not sent" copy of itself); any other failure hands the text back to the composer, and the transcript keeps nothing.
