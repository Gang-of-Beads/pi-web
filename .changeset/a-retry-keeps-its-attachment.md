---
"@vincenthanxiaodu/pi-web": patch
---

Keep attachments on a message that has to be retried

The offline outbox stored a pending message as text alone, and the replay sent
text alone, so a message that carried a screenshot came back as prose about a
screenshot nobody could see. Nothing said so: the bubble replayed and the send
succeeded. Pending messages now carry their attachments through storage and
back out on retry, and entries written before this still load.
