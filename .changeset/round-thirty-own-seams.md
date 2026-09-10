---
"@gang-of-beads/pi-web": patch
---

The restore ladders read their own signal, and machine-specific failures
retire with their machine.

Round 29 removed the load-start banner clear, which silently broke the
deep-link restore ladders: they read a leftover banner from any machine as
"the listing still fails", burned their retries, and announced "X is still
unavailable." over a machine that answered every probe. The ladders now
probe the load's own status, the local ladder's wording guard covers every
attempt, and a reader-retired failure keeps the machine it belongs to - so
deleting that machine retires the claim, as the model always said. The
interrupted-run marker set is stored per machine (adopting one machine's
read no longer evicts another's), the terminal soft keys and the machine
dialog keep their declared type and height against the adopted host sheet,
and the tree navigator's coarse disclosure track reserves what it draws.
