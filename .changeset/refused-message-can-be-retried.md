---
"@gang-of-beads/pi-web": patch
---

A message the server accepted but Pi then refused (for example, because no model is configured) now reads "Not sent", and Retry sends it again. Before, Retry could not find the message and said it may already have been delivered.
