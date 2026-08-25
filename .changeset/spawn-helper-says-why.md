---
"@vincenthanxiaodu/pi-web": patch
---

Say why terminals will not start when node-pty's helper cannot be repaired. The runtime repair for node-pty's missing execute bit can only work where the install is writable; on a read-only one — a nix store path, an image layer — it failed silently and left node-pty to report `posix_spawnp failed.`, which names neither the file nor the cause. The failure is now remembered and attached to the error the terminal reports, naming the helper and where the bit has to be set instead.
