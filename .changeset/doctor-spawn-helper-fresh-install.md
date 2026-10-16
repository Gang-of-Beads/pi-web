---
"@gang-of-beads/pi-web": patch
---

`pi-web doctor` no longer reports a failure on a fresh macOS install because node-pty's `spawn-helper` is not executable yet. When the helper belongs to you, the session daemon makes it executable before it opens the first terminal, so doctor now notes that instead; it still suggests `chmod +x` when the helper belongs to another user and cannot be repaired that way.
