---
"@gang-of-beads/pi-web": patch
---

A chat attachment goes into the workspace as a raw upload instead of riding the prompt as base64, so an APK or a video larger than about 48 MiB is no longer refused with 413. The message carries the workspace path instead, and a page without a workspace warns when its attachments exceed the request ceiling. A 413 now says the machine's limit in MiB, and a refused send returns the words and files to the composer whether or not a draft was already typed.
