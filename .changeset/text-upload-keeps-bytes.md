---
"@gang-of-beads/pi-web": patch
---

A text file that is not UTF-8, such as a `.txt` saved as Windows-1252 or UTF-16, now uploads to a workspace with its bytes unchanged. Before, the upload was refused. Restart the web service.
