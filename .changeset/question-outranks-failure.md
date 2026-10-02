---
"@gang-of-beads/pi-web": patch
---

A session marks its state the same way on every list. A session waiting for your answer is marked as waiting even after an earlier failure; before, a page that saw the failure happen said it hit an error while a freshly opened list said it was waiting. A session listed on the Go to page outside the machine's session board, such as one being created or a pinned session whose project is closed, now wears its mark instead of none. While you browse another machine, its sessions no longer borrow this machine's states. A browser reload picks this up.
