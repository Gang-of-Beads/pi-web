---
"@gang-of-beads/pi-web": patch
---

The daemon remembers what it accepted across a restart. Its ledger of accepted
prompts was in memory and said so — "a daemon restart forgets the ledger" — so a
browser retrying after a lost answer, which is the correct thing for it to do,
made the daemon run the same prompt a second time. Operations are durable rows
now, with four outcomes, the payload's fingerprint, and capacity that refuses
rather than evicting, because dropping a row to make space turns a later replay
back into a second execution. A restart downgrades anything that was in flight
to `unknown` instead of guessing, a repeat with a different payload is refused
as a conflict rather than answered with the first result, and a reconnecting
client can ask which of its operations are still open.
